'use strict'
// 완료 조건 6: BIG_200 을 열어 한 스텝의 descriptionToEmail 만 바꿔 같은 이름으로 배포(force)한다. 서버가 잰 시간·RSS 최고치(X-SE-Deploy-Stats)와 벽시계를 찍는다.
// 기준(설계 §2.6): 로컬 60초 이하 · 서버 peakRssMb 1024 이하 · result 'ok'. 하나라도 어기면 종료 코드 1.
// 서버(SE_DEV_USER_OVERRIDE=1 EARS_INTERFACE_MAX_REQUEST_MB=512 npm --prefix server start)가 떠 있어야 하고 `npm run seed -- big` 이 먼저다. BIG_200 에 새 판이 하나 생긴다(시험 데이터).
// EARS_INTERFACE_MAX_REQUEST_MB=512 가 없으면(기본 100MB) BIG_200 요청(약 116MB)이 422 REQUEST_TOO_LARGE 로 막힌다 — 로컬 InterfaceServer max-content-length 512m 과 같게 한다.
// 큰 배포를 이어 하면 공유 InterfaceServer 컨테이너 메모리가 2 GiB 한도에 닿을 수 있다(CLAUDE.md "InterfaceServer").
const { randomUUID } = require('node:crypto')
const { editedFromSkeleton } = require('../../server/features/scenario-editor/domain/editedScenario')

const API = process.env.API || 'http://127.0.0.1:3100/api/scenario-editor'
const H = { 'X-SE-User': 'sew_master' }
const TARGET = { process: 'SEWPHOTO', model: 'SEWMODELA', name: 'BIG_200' }
const LIMIT = { ms: 60000, peakRssMb: 1024 }

function parseStats(header) {
  const m = Object.fromEntries(String(header || '').split(';').map((kv) => kv.split('=')))
  return { ms: Number(m.ms), peakRssMb: Number(m.peakRssMb) }
}

;(async () => {
  const res = await fetch(`${API}/scenarios/${TARGET.process}/${TARGET.model}/${TARGET.name}/versions/current`, { headers: H })
  const opened = await res.json()
  if (res.status !== 200) throw new Error(`열기 HTTP ${res.status} ${JSON.stringify(opened)} — npm run seed -- big 을 먼저 한다`)
  const sk = opened.data
  const edited = editedFromSkeleton(sk, { fileId: sk.version.fileId })
  const i = Math.floor(edited.steps.length / 2)
  edited.steps[i].descriptionToEmail = `deploy-big ${new Date().toISOString()}`
  const form = new FormData()
  form.append('meta', JSON.stringify({ target: TARGET, propertyRev: sk.propertyRev, scenario: edited, requestId: randomUUID(), force: true }))

  const t = Date.now()
  const r = await fetch(`${API}/deploy`, { method: 'POST', headers: H, body: form })
  const wallMs = Date.now() - t
  const out = await r.json()
  const stats = parseStats(r.headers.get('x-se-deploy-stats'))
  console.log({ ms: stats.ms, peakRssMb: stats.peakRssMb, wallMs })
  console.log('응답:', r.status, r.status === 200 ? out.data : out)

  const failed = []
  if (r.status !== 200 || !out.data || out.data.result !== 'ok') failed.push(`result 가 ok 가 아님 (HTTP ${r.status})`)
  if (!(stats.ms <= LIMIT.ms)) failed.push(`ms ${stats.ms} > ${LIMIT.ms} (또는 X-SE-Deploy-Stats 를 읽지 못함)`)
  if (!(stats.peakRssMb <= LIMIT.peakRssMb)) failed.push(`peakRssMb ${stats.peakRssMb} > ${LIMIT.peakRssMb} (또는 X-SE-Deploy-Stats 를 읽지 못함)`)
  if (failed.length) {
    console.log('목표 밖 — 설계 §2.6')
    for (const m of failed) console.log('  실패:', m)
  } else {
    console.log(`목표 안(${LIMIT.ms / 1000}초·RSS ${LIMIT.peakRssMb}MB 이하)`)
  }
  process.exitCode = failed.length ? 1 : 0
})().catch((e) => { console.error(e.message); process.exit(1) })
