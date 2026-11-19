'use strict'
// SEW-018: [이 버전으로 되돌려 열기] 를 큰 시나리오로 할 때의 서버 최고 메모리. 화면(editorStore.openRestore)처럼 옛 판과 현재 판을 동시에 연다.
// 기준: 큰 시나리오 열기와 같은 서버 peakRssMb 1024 이하(설계 §2.4). 둘 다 차가운 열기(fromCache=false)여야 한다. 어기면 종료 코드 1.
// 준비: `npm run seed -- big` → 서버를 띄워 `node tools/measure/deploy-big.js`(BIG_200 에 둘째 판) → 서버를 새로 띄운 뒤 이 도구.
//   서버를 새로 띄우는 것은 배포 때 오른 메모리가 섞이지 않게다(X-SE-Open-Stats 의 peakRssMb 는 프로세스 전체 RSS 다).
// 끝나면 `npm run seed -- reset basic anomaly && npm run seed -- big` 으로 BIG_200 을 한 판으로 되돌린다.
const API = process.env.API || 'http://127.0.0.1:3100/api/scenario-editor'
const H = { 'X-SE-User': 'sew_master' }
const BASE = `${API}/scenarios/SEWPHOTO/SEWMODELA/BIG_200`
const LIMIT = { peakRssMb: 1024 }

function parseStats(header) {
  const m = Object.fromEntries(String(header || '').split(';').map((kv) => kv.split('=')))
  return { ms: Number(m.ms), peakRssMb: Number(m.peakRssMb), fromCache: m.fromCache === 'true' }
}

async function open(crtime, t0) {
  const res = await fetch(`${BASE}/versions/${crtime}`, { headers: H })
  const body = await res.json()
  if (res.status !== 200) throw new Error(`${crtime} 열기 HTTP ${res.status} ${JSON.stringify(body)}`)
  return { crtime, doneAtMs: Date.now() - t0, steps: body.data.steps.length, stats: parseStats(res.headers.get('x-se-open-stats')) }
}

;(async () => {
  const vr = await fetch(`${BASE}/versions`, { headers: H })
  const versions = (await vr.json()).data
  if (vr.status !== 200) throw new Error(`판 목록 HTTP ${vr.status}`)
  const old = versions.filter((v) => !v.isCurrent).sort((a, b) => a.crtime - b.crtime)[0]
  if (!old) throw new Error(`옛 판이 없다(판 ${versions.length}개) — deploy-big.js 로 둘째 판을 먼저 만든다`)
  const refresh = await fetch(`${API}/cache/refresh?images=1`, { method: 'POST', headers: H })
  if (!refresh.ok) throw new Error(`cache/refresh HTTP ${refresh.status} — 캐시를 비우지 못해 차갑게 잴 수 없다`)

  const t0 = Date.now()
  const [a, b] = await Promise.all([open(String(old.crtime), t0), open('current', t0)])
  const wallMs = Date.now() - t0
  console.log('판:', versions.length, '개, 옛 판', old.crtime)
  console.log('옛 판  :', a)
  console.log('현재 판:', b)
  console.log('둘 다 끝:', wallMs, 'ms')

  const failed = []
  if (a.stats.fromCache || b.stats.fromCache) failed.push('차가운 열기가 아니다(fromCache=true — 캐시 비우기 실패?)')
  const peak = Math.max(a.stats.peakRssMb, b.stats.peakRssMb)
  if (!(peak <= LIMIT.peakRssMb)) failed.push(`peakRssMb ${peak} > ${LIMIT.peakRssMb} (또는 X-SE-Open-Stats 를 읽지 못함)`)
  if (failed.length) {
    console.log('목표 밖 — 화면이 두 판을 차례로 열게 바꾼다(SEW-018)')
    for (const m of failed) console.log('  실패:', m)
  } else {
    console.log(`목표 안(RSS ${LIMIT.peakRssMb}MB 이하, peakRssMb ${peak})`)
  }
  process.exitCode = failed.length ? 1 : 0
})().catch((e) => { console.error(e.message); process.exit(1) })
