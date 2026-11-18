'use strict'
// 시험 실행(P5)의 결과 메일 수신인 데이터 — EMAILINFO(묶음 → 주소)·EMAIL_RECIPIENTS(시나리오별 수신 규칙).
// 묶음 이름은 SEW- 로 시작한다(정리가 이것으로 지운다 — 공유 로컬 EARS 의 다른 EMAILINFO 는 건드리지 않는다). 주소는 예시 도메인이다.
const emailInfos = [
  // SEWCVD/SEWMODELA 설비의 기본 묶음(설비의 emailcategory)
  { project: 'ARS', category: 'SEW-SEWCVD-SEWMODELA-MAIL', departments: ['sew'], accounts: ['sew.day@example.com', 'sew.eng@example.com'] },
  // RUN_PROPS 의 수신 규칙이 가리키는 묶음 — 빈 주소는 발송 때 빠진다
  { project: 'ARS', category: 'SEW-RUN-NIGHT', departments: ['sew'], accounts: ['sew.night@example.com', '', 'sew.lead@example.com'] }
]
// SEWT_DUP01 의 묶음 SEW-SEWCVD-SEWMODELA-NONE 은 일부러 넣지 않는다("수신 주소가 등록돼 있지 않다")
const emailRules = [
  { app: 'ARS', code: 'RUN_PROPS', process: 'SEWCVD', model: 'SEWMODELA', line: 'all', emailCategory: 'SEW-RUN-NIGHT' }
]

module.exports = { emailInfos, emailRules }
