import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { checkEnv } = require('../preflight')

// 서버 설정 예시 두 개(로컬 개발 .env.example · 사내 .env.inhouse.example)는 같은 구역을 같은 순서로 두고, 구역마다 같은 변수를 같은 순서로 둔다.
// 2026-11-11: 사내 첫 배포가 EARS_INTERFACE_URL 을 넣지 않아 실패했다 — 두 파일의 구성과 설명이 달라 어느 줄을 채울지 찾기 어려웠다(사용자).
// 한 프로필에서 읽지 않는 변수는 지우지 않고 그 자리에 `# 쓰지 않음: 이름 — 이유` 로 남긴다.
const read = (name) => readFileSync(new URL(`../../../server/${name}`, import.meta.url), 'utf8')

function parse(text) {
  const sections = []
  for (const line of text.split(/\r?\n/)) {
    const head = /^# ── \[(\d+)\] (.+) ──$/.exec(line)
    if (head) { sections.push({ no: Number(head[1]), title: head[2], keys: [] }); continue }
    const active = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    const unused = /^# 쓰지 않음: ([A-Z][A-Z0-9_]*) — \S/.exec(line)
    if (!active && !unused) continue
    if (!sections.length) throw new Error(`구역 머리(# ── [n] 제목 ──) 앞에 변수가 있다: ${line}`)
    sections.at(-1).keys.push(active ? { name: active[1], used: true, value: active[2] } : { name: unused[1], used: false })
  }
  return sections
}
const names = (s) => s.keys.map((k) => k.name)
const used = (sections) => Object.fromEntries(sections.flatMap((s) => s.keys.filter((k) => k.used).map((k) => [k.name, k.value])))

const local = parse(read('.env.example'))
const inhouse = parse(read('.env.inhouse.example'))

describe('서버 설정 예시 두 개의 구성', () => {
  it('구역이 1번부터 차례로 있고 두 파일이 같은 번호·제목이다', () => {
    expect(local.length).toBeGreaterThanOrEqual(6)
    expect(local.map((s) => s.no)).toEqual(local.map((_, i) => i + 1))
    expect(inhouse.map((s) => `${s.no} ${s.title}`)).toEqual(local.map((s) => `${s.no} ${s.title}`))
  })

  it('구역마다 같은 변수를 같은 순서로 둔다(읽지 않는 변수는 "쓰지 않음" 줄)', () => {
    for (const [i, s] of local.entries()) expect(names(inhouse[i]), `[${s.no}] ${s.title}`).toEqual(names(s))
  })

  it('한 파일 안에 같은 변수가 두 번 나오지 않는다', () => {
    for (const sections of [local, inhouse]) {
      const all = sections.flatMap(names)
      expect(all.filter((n, i) => all.indexOf(n) !== i)).toEqual([])
    }
  })

  it('웹 전용 DB 주소: 로컬은 WEBMANAGER_DB_URI(SE_WEBMANAGER_DB=1), 사내는 SE_WEB_DB_URI(SE_WEBMANAGER_DB=0) — 다른 쪽 변수는 쓰지 않음', () => {
    const l = used(local); const h = used(inhouse)
    expect(l.SE_WEBMANAGER_DB).toBe('1')
    expect(l.WEBMANAGER_DB_URI).toMatch(/\/SE_WEB_DEV$/)
    expect('SE_WEB_DB_URI' in l).toBe(false)
    expect(h.SE_WEBMANAGER_DB).toBe('0')
    expect('SE_WEB_DB_URI' in h).toBe(true)
    expect('WEBMANAGER_DB_URI' in h).toBe(false)
  })

  it('사내 예시를 그대로 두면 사전 점검이 채울 곳을 멈춤으로 알린다(웹 전용 DB) — 채우면 멈춤이 없다', () => {
    const h = used(inhouse)
    expect(h.HOST).toBe('127.0.0.1')
    expect(h.SE_DEV_USER_OVERRIDE).toBe('0')
    expect(h.EARS_INTERFACE_URL).toMatch(/^http:\/\/<.+>:<.+>$/) // 꼴(http://호스트:포트)을 그대로 보인다
    expect(checkEnv(h).filter((f) => f.level === 'stop').map((f) => f.code)).toContain('WEB_DB_MISSING')
    expect(checkEnv(h).filter((f) => f.level === 'stop').map((f) => f.code)).toContain('PLACEHOLDER_LEFT') // <…> 를 채우지 않음(SEW-024)
    const filled = { ...h, MONGODB_URI: 'mongodb://u:p@prod:27017/EARS', REDIS_URL: 'redis://:p@prod-redis:6379/0', SE_WEB_DB_URI: 'mongodb://u:p@prod:27017/WEB_MANAGER', EARS_INTERFACE_URL: 'http://10.1.2.3:8080', SE_USER_SINGLEID: 'hong.gildong' }
    expect(checkEnv(filled).filter((f) => f.level === 'stop')).toEqual([])
  })
})
