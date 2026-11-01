import { describe, it, expect, beforeAll, afterAll } from 'vitest'

let server
let base
beforeAll(async () => {
  process.env.SE_USER_SINGLEID = 'sew_multi'
  const app = (await import('../../../app')).default
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => new Promise((resolve) => server.close(resolve)))

describe('/api/scenario-editor', () => {
  it('ping 은 인증 대역을 거쳐 사용자를 돌려준다', async () => {
    const res = await fetch(`${base}/api/scenario-editor/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { singleid: 'sew_multi' } })
  })
})
