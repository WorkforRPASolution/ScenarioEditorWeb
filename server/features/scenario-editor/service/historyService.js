'use strict'
// 자동 복구 이력 보기 (P3 설계 §4.7·§5.6) — 태그 스냅샷의 txn 으로 이력 서버(HttpWebServer)의 이력을 읽어 스텝·설명·그림만 준다.
// - 설비는 내 공정 범위의 유효 설비만(scopes.equipmentOf). 검사를 지난 뒤에만 이력 서버를 부른다.
// - 이력 서버의 HTML 은 응답에 싣지 않는다(domain/historyHtml 이 뽑은 것만).
const { seError } = require('../errors')
const { parseHistoryHtml } = require('../domain/historyHtml')
const { HISTORY_MIN_TXN } = require('../domain/snapshotName')

const TXN = /^\d{1,16}$/ // `$` 는 끝의 줄바꿈 앞에서도 맞는다 — 줄바꿈은 따로 막는다

function createHistoryService({ client, scopes }) {
  async function get(user, eqpId, txn) {
    await scopes.equipmentOf(user, eqpId)
    if (typeof txn !== 'string' || txn.includes('\n') || !TXN.test(txn) || Number(txn) < HISTORY_MIN_TXN) {
      throw seError(400, 'BAD_REQUEST', `txn 은 ${HISTORY_MIN_TXN} 이상의 숫자여야 합니다`, { path: 'txn' })
    }
    // 이력 서버는 설비 ID 를 CQL 글자에 그대로 붙인다(사내 결함) — 작은따옴표가 든 값은 보내지 않는다
    if (eqpId.includes("'")) throw seError(400, 'BAD_REQUEST', '이 설비 ID 로는 이력을 볼 수 없습니다', { path: 'eqpId' })
    const steps = parseHistoryHtml(await client.fetchHtml(eqpId, txn))
    if (!steps.length) throw seError(502, 'HISTORY_UNREADABLE', '이력 서버의 응답에서 스텝을 읽지 못했습니다')
    return { eqpId, txn, steps }
  }

  return { get }
}

module.exports = { createHistoryService }
