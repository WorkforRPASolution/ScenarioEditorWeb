'use strict'
const eq = (eqpId, process, eqpModel, n, over = {}) => ({
  line: 'SEWLINE1', lineDesc: 'SEW 시험 라인 1', process, eqpModel, eqpId, category: 'Process',
  emailcategory: `SEW-${process}-${eqpModel}-MAIL`, osVer: 'Windows 10', webmanagerUse: 1, onoff: 1,
  ipAddr: `10.99.${n}.1`, ipAddrL: '', localpc: 0, snapshotTimeDiff: 0, installdate: '2026-11-01', ...over
})

const equipment = [
  eq('SEWT_CVD_A01', 'SEWCVD', 'SEWMODELA', 1), eq('SEWT_CVD_A02', 'SEWCVD', 'SEWMODELA', 2), eq('SEWT_CVD_B01', 'SEWCVD', 'SEWMODELB', 3),
  eq('SEWT_ETCH_A01', 'SEWETCH', 'SEWMODELA', 4), eq('SEWT_ETCH_B01', 'SEWETCH', 'SEWMODELB', 5),
  eq('SEWT_PHOTO_A01', 'SEWPHOTO', 'SEWMODELA', 6), eq('SEWT_PHOTO_B01', 'SEWPHOTO', 'SEWMODELB', 7),
  // 데이터 점검용 (모두 SEWCVD/SEWMODELA)
  eq('SEWT_BADREQ', 'SEWCVD', 'SEWMODELA', 8, { category: '' }),
  eq('SEWT_BADMAIL', 'SEWCVD', 'SEWMODELA', 9, { emailcategory: 'A-B-C' }),
  // 수신 묶음이 다른 설비(P5): 이 묶음의 EMAILINFO 는 없다 — "수신 주소가 등록돼 있지 않다"
  eq('SEWT_DUP01', 'SEWCVD', 'SEWMODELA', 10, { emailcategory: 'SEW-SEWCVD-SEWMODELA-NONE' }),
  eq('SEWT_PRX01', 'SEWCVD', 'SEWMODELA', 11, { localpc: 1, ipAddr: '10.99.11.1', ipAddrL: '192.168.0.11' }),
  eq('SEWT_PRX02', 'SEWCVD', 'SEWMODELA', 12, { localpc: 1, ipAddr: '10.99.11.1', ipAddrL: '192.168.0.11' }),
  // 시험 실행(P5): 자동조치 OFF 설비 — 유효 설비지만 실행 요청을 보내지 않는다
  eq('SEWT_CVD_OFF', 'SEWCVD', 'SEWMODELA', 13, { onoff: 0 })
]
// SEWT_DUP01 은 AGENT_INFO 두 문서 → 조인 결과에 두 번(EQP_INFO.eqpId 는 로컬 유일 인덱스라 그쪽 중복은 못 만든다)
const agents = [...equipment.map((e) => ({ eqpId: e.eqpId, arsagentJava: 1 })), { eqpId: 'SEWT_DUP01', arsagentJava: 1 }]

module.exports = { equipment, agents }
