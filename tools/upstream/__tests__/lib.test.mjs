import { describe, it, expect } from 'vitest'
import { sha256, gitReadRef, planImport, compare } from '../lib.mjs'

const buf = (s) => Buffer.from(s, 'utf8')

describe('gitReadRef — WebManager 작업 트리가 아니라 커밋 객체에서만 읽는다', () => {
  it('git -C <WebManager> show <커밋>:<경로> 만 부른다', () => {
    const calls = []
    const exec = (cmd, args) => { calls.push([cmd, ...args]); return buf('X') }
    const read = gitReadRef('/wm', 'abc1234', exec)
    expect(read('client/src/main.js')).toEqual(buf('X'))
    expect(calls).toEqual([['git', '-C', '/wm', 'show', 'abc1234:client/src/main.js']])
  })
  it('커밋에 없는 경로는 null', () => {
    const read = gitReadRef('/wm', 'abc1234', () => { throw new Error('fatal: path does not exist') })
    expect(read('nope.js')).toBe(null)
  })
})

describe('sha256', () => {
  it('같은 내용은 같은 해시', () => {
    expect(sha256('a')).toBe(sha256(buf('a')))
    expect(sha256('a')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('planImport', () => {
  const manifest = {
    source: 'WebManager', commit: 'abc1234',
    files: [
      { path: 'client/src/main.js', mode: 'verbatim' },
      { path: 'client/src/App.vue', mode: 'shell-modified', reason: '레이아웃 하나' },
      { path: 'client/src/shared/stores/auth.js', mode: 'stub', reason: '로그인 없음' },
      { path: 'client/missing.js', mode: 'verbatim' }
    ]
  }
  const ref = { 'client/src/main.js': 'MAIN', 'client/src/App.vue': 'APP', 'client/src/shared/stores/auth.js': 'AUTH' }
  const readRef = (p) => (p in ref ? buf(ref[p]) : null)

  it('verbatim 은 쓰고, shell-modified 는 로컬이 없을 때만 원본을 쓰고, stub 은 쓰지 않는다', () => {
    const r = planImport(manifest, readRef, () => null)
    expect(r.writes.map((w) => w.path)).toEqual(['client/src/main.js', 'client/src/App.vue'])
    expect(r.missing).toEqual(['client/missing.js'])
  })

  it('shell-modified 로컬이 이미 있으면 덮어쓰지 않는다', () => {
    const r = planImport(manifest, readRef, (p) => (p === 'client/src/App.vue' ? buf('MINE') : null))
    expect(r.writes.map((w) => w.path)).toEqual(['client/src/main.js'])
  })

  it('기록은 원본 해시와 (verbatim 이면) 로컬 해시를 남긴다', () => {
    const r = planImport(manifest, readRef, () => null)
    const main = r.records.find((x) => x.path === 'client/src/main.js')
    expect(main).toEqual({ path: 'client/src/main.js', mode: 'verbatim', sourceSha256: sha256('MAIN'), localSha256: sha256('MAIN'), reason: null })
    const auth = r.records.find((x) => x.path === 'client/src/shared/stores/auth.js')
    expect(auth.localSha256).toBe(null)
    expect(auth.sourceSha256).toBe(sha256('AUTH'))
  })
})

describe('compare', () => {
  const upstream = {
    commit: 'abc1234',
    files: [
      { path: 'a.js', mode: 'verbatim', sourceSha256: sha256('A'), localSha256: sha256('A') },
      { path: 'b.js', mode: 'stub', sourceSha256: sha256('B'), localSha256: null },
      { path: 'c.js', mode: 'verbatim', sourceSha256: sha256('C'), localSha256: sha256('C') }
    ]
  }
  it('verbatim 을 손대면 localEdits, 원본이 바뀌면 upstreamChanged, 원본이 사라지면 upstreamRemoved', () => {
    const readRef = (p) => ({ 'a.js': buf('A'), 'b.js': buf('B2') }[p] ?? null)
    const readLocal = (p) => ({ 'a.js': buf('A-edited'), 'b.js': buf('mine'), 'c.js': buf('C') }[p] ?? null)
    expect(compare(upstream, readRef, readLocal)).toEqual({ localEdits: ['a.js'], upstreamChanged: ['b.js'], upstreamRemoved: ['c.js'] })
  })
  it('stub·shell-modified 의 로컬 내용은 보지 않는다', () => {
    const readRef = (p) => ({ 'a.js': buf('A'), 'b.js': buf('B'), 'c.js': buf('C') }[p])
    const readLocal = (p) => ({ 'a.js': buf('A'), 'b.js': buf('anything'), 'c.js': buf('C') }[p])
    expect(compare(upstream, readRef, readLocal)).toEqual({ localEdits: [], upstreamChanged: [], upstreamRemoved: [] })
  })
})
