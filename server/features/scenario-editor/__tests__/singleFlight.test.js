import { describe, it, expect } from 'vitest'
import { createSingleFlight } from '../util/singleFlight'

describe('singleFlight', () => {
  it('같은 키의 동시 호출은 한 번만 실행하고 결과를 나눈다', async () => {
    const sf = createSingleFlight()
    let n = 0
    const fn = () => new Promise((r) => setTimeout(() => r(++n), 20))
    const [a, b] = await Promise.all([sf.run('k', fn), sf.run('k', fn)])
    expect([a, b, n]).toEqual([1, 1, 1])
    expect(await sf.run('k', fn)).toBe(2)
  })
  it('실패도 나누고, 다음 호출은 다시 실행한다', async () => {
    const sf = createSingleFlight()
    let n = 0
    const bad = () => Promise.reject(new Error(`x${++n}`))
    await expect(Promise.all([sf.run('k', bad), sf.run('k', bad)])).rejects.toThrow('x1')
    await expect(sf.run('k', bad)).rejects.toThrow('x2')
  })
})
