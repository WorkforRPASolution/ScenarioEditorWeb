import { describe, it, expect } from 'vitest'
import { createSemaphore } from '../util/semaphore'

const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createSemaphore', () => {
  it('limit 1 이면 앞 작업이 끝나야 다음이 시작한다', async () => {
    const sem = createSemaphore(1)
    const a = deferred()
    const started = []
    const first = sem.run(async () => { started.push('a'); await a.promise; return 'A' })
    const second = sem.run(async () => { started.push('b'); return 'B' })
    await tick()
    expect(started).toEqual(['a'])
    a.resolve()
    expect(await first).toBe('A')
    expect(await second).toBe('B')
    expect(started).toEqual(['a', 'b'])
  })
  it('기다린 순서대로 실행한다', async () => {
    const sem = createSemaphore(1)
    const a = deferred()
    const order = []
    const all = [sem.run(() => a.promise), ...['b', 'c', 'd'].map((x) => sem.run(async () => { order.push(x) }))]
    a.resolve()
    await Promise.all(all)
    expect(order).toEqual(['b', 'c', 'd'])
  })
  it('limit 2 면 둘까지 함께 돈다', async () => {
    const sem = createSemaphore(2)
    const gate = deferred()
    let running = 0
    let peak = 0
    const job = () => sem.run(async () => { running++; peak = Math.max(peak, running); await gate.promise; running-- })
    const all = [job(), job(), job()]
    await tick()
    expect(running).toBe(2)
    gate.resolve()
    await Promise.all(all)
    expect(peak).toBe(2)
  })
  it('앞 작업이 실패해도 자리를 돌려주고 실패는 그 작업에만 간다', async () => {
    const sem = createSemaphore(1)
    const failed = sem.run(async () => { throw new Error('x') })
    const next = sem.run(async () => 'ok')
    await expect(failed).rejects.toThrow('x')
    expect(await next).toBe('ok')
  })
  it('동기로 던져도 자리를 돌려준다', async () => {
    const sem = createSemaphore(1)
    await expect(sem.run(() => { throw new Error('x') })).rejects.toThrow('x')
    expect(await sem.run(() => 'ok')).toBe('ok')
  })
})
