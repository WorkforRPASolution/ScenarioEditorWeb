// 이력 서비스 — 설비 범위·txn 검사 뒤에만 이력 서버를 부르고, HTML 에서 뽑은 스텝만 준다 (P3 설계 §4.7·§5.2·§5.6)
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createHistoryService } = require('../service/historyService')
const { seError } = require('../errors')

const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const HTML = `<body><table bgColor=#308cfc><tbody><tr><th><strong>1.확인</strong><img src="data:Image/png;base64,${B64}" /></th></tr><tr><td><img src="data:Image/png;base64,${B64}" /></td></tr></tbody></table><br></body>`
const USER = { singleid: 'u1' }
function make({ html = HTML, allowed = ['E1', "E'1"], fail = null } = {}) {
  const calls = []
  const scopes = {
    equipmentOf: async (user, eqpId) => {
      calls.push(['scope', user.singleid, eqpId])
      if (!allowed.includes(eqpId)) throw seError(403, 'EQP_FORBIDDEN', '이 설비를 볼 권한이 없습니다')
      return { eqpId }
    }
  }
  const client = { fetchHtml: async (eqpId, txn) => { calls.push(['fetch', eqpId, txn]); if (fail) throw fail; return html } }
  return { service: createHistoryService({ client, scopes }), calls }
}
const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }

describe('historyService.get', () => {
  it('설비·txn 을 그대로 넘기고 스텝을 준다', async () => {
    const { service, calls } = make()
    expect(await service.get(USER, 'E1', '1763254800000')).toEqual({
      eqpId: 'E1', txn: '1763254800000',
      steps: [{ no: 1, text: '확인', images: [{ kind: 'ref', src: `data:image/png;base64,${B64}` }, { kind: 'screen', src: `data:image/png;base64,${B64}` }] }]
    })
    expect(calls).toEqual([['scope', 'u1', 'E1'], ['fetch', 'E1', '1763254800000']])
  })

  it('범위 밖 설비는 이력 서버를 부르지 않고 403 EQP_FORBIDDEN', async () => {
    const { service, calls } = make()
    const e = await caught(service.get(USER, 'OTHER', '100000'))
    expect([e.statusCode, e.code]).toEqual([403, 'EQP_FORBIDDEN'])
    expect(calls.filter((c) => c[0] === 'fetch')).toEqual([])
  })

  it('txn 은 숫자 1~16자리이고 99999 이상 — 아니면 부르지 않고 400', async () => {
    const { service, calls } = make()
    for (const txn of ['99998', '0', '', 'abc', '1e9', '-100000', '100000.5', ' 100000', '12345678901234567', undefined, 100000, '100000\n']) {
      const e = await caught(service.get(USER, 'E1', txn))
      expect([e.statusCode, e.code, txn]).toEqual([400, 'BAD_REQUEST', txn])
    }
    expect(calls.filter((c) => c[0] === 'fetch')).toEqual([])
    await service.get(USER, 'E1', '99999')
    await service.get(USER, 'E1', '1234567890123456')
    expect(calls.filter((c) => c[0] === 'fetch').map((c) => c[2])).toEqual(['99999', '1234567890123456'])
  })

  it('작은따옴표가 든 설비 ID 는 이력 서버에 보내지 않는다 (이력 서버가 CQL 글자에 그대로 붙인다)', async () => {
    const { service, calls } = make()
    const e = await caught(service.get(USER, "E'1", '100000'))
    expect([e.statusCode, e.code]).toEqual([400, 'BAD_REQUEST'])
    expect(calls.filter((c) => c[0] === 'fetch')).toEqual([])
  })

  it('스텝을 하나도 못 뽑으면 502 HISTORY_UNREADABLE', async () => {
    for (const html of ['<html><body><script>alert(1)</script></body></html>', '', '<b>1단계</b>']) {
      const e = await caught(make({ html }).service.get(USER, 'E1', '100000'))
      expect([e.statusCode, e.code]).toEqual([502, 'HISTORY_UNREADABLE'])
    }
  })

  it('이력 서버 오류는 그대로 올린다', async () => {
    const fail = seError(404, 'HISTORY_NOT_FOUND', '이력이 없습니다')
    expect(await caught(make({ fail }).service.get(USER, 'E1', '100000'))).toBe(fail)
  })
})
