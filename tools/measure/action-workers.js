'use strict'
// InterfaceServer /EARS/Action(recovery)의 실제 동작을 잰다(P5 설계 §3 의 [추정] — P5-A). 로컬 InterfaceServer 컨테이너가 떠 있어야 하고
// 포트 3195(CommandServer 흉내)가 비어 있어야 한다. 통합 시험·E2E 와 동시에 돌리지 않는다. 아무것도 저장하지 않는다(흉내는 실행 기록을 넣지 않는다).
//   node tools/measure/action-workers.js
// 재는 것: ① 한 건 ② 흉내가 4초 늦을 때 두 건을 동시에 — 둘째가 4초대면 일꾼 여럿, 8초대면 하나 ③ 2초 늦을 때 세 건
//          ④ 흉내가 500 ⑤ 흉내가 6초 늦음(InterfaceServer 의 응답 제한 5초를 넘김) ⑥ 흉내 없음 ⑦ category 없음 ⑧ txn 이 숫자가 아님
const { startFakeCommandServer } = require('../infra/fake-command-server')

const IS = process.env.EARS_INTERFACE_URL || 'http://127.0.0.1:8080'
const HEADERS = { 'Content-Type': 'application/json', category: 'recovery', process: 'SEWCVD', model: 'SEWMODELA', eqpid: 'SEWT_MEASURE', name: 'SEW_MEASURE', line: 'SEWLINE1', txn: String(Date.now()), triggeredBy: 'SE' }
const BODY = JSON.stringify({ '@UserInfo': 'measure - measure', '@StartStep': '1', UserText: 'INSPECTION' })

async function call(headers = HEADERS) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${IS}/EARS/Action`, { method: 'POST', headers, body: BODY, signal: AbortSignal.timeout(30000) })
    const text = await res.text()
    return { ms: Date.now() - t0, status: res.status, text: text.slice(0, 120) }
  } catch (e) {
    return { ms: Date.now() - t0, error: (e.cause && e.cause.code) || e.name }
  }
}
const show = (label, r) => console.log(`${label}: ${Array.isArray(r) ? r.map((x) => `${x.ms}ms ${x.status ?? x.error} ${x.text ?? ''}`).join(' | ') : `${r.ms}ms ${r.status ?? r.error} ${r.text ?? ''}`}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let fake = await startFakeCommandServer()
  try {
    show('① 한 건', await call())
    fake.set({ delayMs: 4000 })
    show('② 4초 늦음 · 두 건 동시', await Promise.all([call(), call()]))
    fake.set({ delayMs: 2000 })
    show('③ 2초 늦음 · 세 건 동시', await Promise.all([call(), call(), call()]))
    fake.set({ delayMs: 0, status: 500 })
    show('④ 흉내가 500', await call())
    fake.reset()
    fake.set({ delayMs: 6000 })
    show('⑤ 6초 늦음(응답 제한 5초를 넘김)', await call())
    await sleep(1500)
    console.log(`   흉내가 받은 요청 수: ${fake.calls.length} (받았는데도 InterfaceServer 는 실패로 답한다)`)
    fake.reset()
  } finally {
    await fake.close()
    fake = null
  }
  show('⑥ 흉내 없음', await call())
  const { category, ...noCategory } = HEADERS
  show('⑦ category 없음', await call(noCategory))
  show('⑧ txn 이 숫자가 아님', await call({ ...HEADERS, txn: 'abc' }))
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
