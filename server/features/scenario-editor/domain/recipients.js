'use strict'
// 결과 메일의 수신 묶음(P5 설계 §5.5) — 실제 발송 규칙을 옮긴 순수 함수. 시험 실행 창이 "누가 메일을 받는가" 를 보이는 데 쓴다(읽기만).
// 출처: HttpWebServer actor/EmailWorker.scala getEmailCategory(묶음 정하기) · EmailingAgent actor/EmailActor.scala _sendEmail(묶음 → 주소).
// 사내 편집기의 표시(첫 설비 하나·묶음 이름을 다시 만듦 — DC-041)와 다르다. 메일을 보낼지는 결과와 메일 생략 속성이 먼저 정한다.
const isText = (v) => typeof v === 'string' && v !== ''

// rules = EMAIL_RECIPIENTS 의 { app: 'ARS', code: 시나리오 이름 } 문서들. eqp = EQP_INFO 문서(라인은 설비의 line — 실제로는 에이전트가 알린 값이다).
// 차례로 처음 맞는 줄: (공정·모델·라인) → (공정·모델, 라인 all) → (공정, 모델·라인 all) → (셋 다 all). 없으면 설비의 emailcategory.
// 맞는 줄이 있는데 묶음 이름이 비었으면 메일이 가지 않는다(설비 값으로 넘어가지 않는다).
function categoryOf(rules, eqp) {
  const list = Array.isArray(rules) ? rules : []
  const find = (p, m, l) => list.find((r) => r && r.process === p && r.model === m && r.line === l)
  const hit = find(eqp.process, eqp.eqpModel, eqp.line) ?? find(eqp.process, eqp.eqpModel, 'all') ?? find(eqp.process, 'all', 'all') ?? find('all', 'all', 'all')
  if (hit) return isText(hit.emailCategory) ? { category: hit.emailCategory, source: 'rule', problem: null } : { category: '', source: 'rule', problem: 'EMPTY_RULE' }
  return isText(eqp.emailcategory) ? { category: eqp.emailcategory, source: 'equipment', problem: null } : { category: '', source: 'equipment', problem: 'NO_CATEGORY' }
}

// infos = Map(묶음 이름 → EMAILINFO { project: 'ARS', category } 문서들). 정확히 1건일 때만 그 accounts 로 보낸다(빈 글은 뺀다).
function groupRecipients({ rules, equipment, infos }) {
  const groups = new Map()
  for (const e of equipment ?? []) {
    const c = categoryOf(rules, e)
    const key = JSON.stringify([c.category, c.source, c.problem])
    if (!groups.has(key)) groups.set(key, { ...c, eqpIds: [] })
    groups.get(key).eqpIds.push(e.eqpId)
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return [...groups.values()].sort((a, b) => cmp(a.category, b.category) || cmp(a.source, b.source)).map((g) => {
    let accounts = []
    let problem = g.problem
    if (!problem) {
      const docs = infos?.get(g.category) ?? []
      if (docs.length === 0) problem = 'INFO_MISSING'
      else if (docs.length > 1) problem = 'INFO_MANY'
      else accounts = Array.isArray(docs[0].accounts) ? docs[0].accounts.filter(isText) : []
    }
    return { category: g.category, source: g.source, eqpIds: g.eqpIds.slice().sort(cmp), accounts, problem }
  })
}

module.exports = { categoryOf, groupRecipients }
