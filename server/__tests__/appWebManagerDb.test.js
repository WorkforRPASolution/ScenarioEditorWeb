import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

let server
let base
beforeAll(async () => {
  process.env.SE_WEBMANAGER_DB = '0'
  const app = require('../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => {
  delete process.env.SE_WEBMANAGER_DB
  return new Promise((r) => server.close(r))
})

describe('SE_WEBMANAGER_DB=0 으로 띄운 앱', () => {
  it('상태 확인에서 WEBMANAGER 는 disabled 다', async () => {
    const body = await (await fetch(`${base}/api/health`)).json()
    expect(body.components.mongodb.webManager).toBe('disabled')
  })

  it('오류 응답을 내도 WebManagerLog 를 저장하지 않는다', async () => {
    const res = await fetch(`${base}/api/없는-경로`)
    expect(res.status).toBe(404)
    const { WebManagerLog } = require('../shared/models/webmanagerLogModel')
    const doc = new WebManagerLog({ category: 'error' })
    expect(await doc.save()).toBe(doc)
  }, 3000)
})
