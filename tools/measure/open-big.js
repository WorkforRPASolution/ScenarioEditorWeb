'use strict'
// 완료 조건 4: BIG_200 첫 열기·다시 열기 시간과 서버 RSS 최고치(X-SE-Open-Stats). 서버(npm run dev 또는 npm --prefix server start)가 떠 있어야 한다.
// 기준(설계 §2.4): 첫 열기 30초 이하 · 다시 열기 1초 이하 · 서버 peakRssMb 1024 이하. 첫 열기는 차가운(fromCache=false), 다시 열기는 캐시(fromCache=true)여야 한다.
const API = process.env.API || 'http://127.0.0.1:3100/api/scenario-editor'
const H = { 'X-SE-User': 'sew_master' }
const LIMIT = { firstMs: 30000, secondMs: 1000, peakRssMb: 1024 }

function parseStats(header) {
  const m = Object.fromEntries(String(header || '').split(';').map((kv) => kv.split('=')))
  return { ms: Number(m.ms), peakRssMb: Number(m.peakRssMb), fromCache: m.fromCache === 'true' }
}

async function openOnce() {
  const t = Date.now()
  const res = await fetch(`${API}/scenarios/SEWPHOTO/SEWMODELA/BIG_200/versions/current`, { headers: H })
  const body = await res.json()
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${JSON.stringify(body)}`)
  const raw = res.headers.get('x-se-open-stats')
  return { wallMs: Date.now() - t, stats: raw, parsed: parseStats(raw), steps: body.data.steps.length, bytes: JSON.stringify(body).length }
}

;(async () => {
  const refresh = await fetch(`${API}/cache/refresh?images=1`, { method: 'POST', headers: H })
  if (!refresh.ok) throw new Error(`cache/refresh HTTP ${refresh.status} — 캐시를 비우지 못해 첫 열기를 차갑게 잴 수 없다`)
  const first = await openOnce()
  const second = await openOnce()
  const { parsed: p1, ...f } = first
  const { parsed: p2, ...s } = second
  console.log('첫 열기  :', f)
  console.log('다시 열기:', s)
  const failed = []
  if (p1.fromCache) failed.push('첫 열기가 fromCache=true — 차가운 열기가 아니다(캐시 비우기 실패?)')
  if (!p2.fromCache) failed.push('다시 열기가 fromCache=false — 캐시를 못 탔다')
  if (first.wallMs > LIMIT.firstMs) failed.push(`첫 열기 ${first.wallMs}ms > ${LIMIT.firstMs}ms`)
  if (second.wallMs > LIMIT.secondMs) failed.push(`다시 열기 ${second.wallMs}ms > ${LIMIT.secondMs}ms`)
  const peak = Math.max(p1.peakRssMb, p2.peakRssMb)
  if (!(peak <= LIMIT.peakRssMb)) failed.push(`peakRssMb ${peak} > ${LIMIT.peakRssMb} (또는 X-SE-Open-Stats 를 읽지 못함)`)
  if (failed.length) {
    console.log('목표 밖 — 설계 §2.4 에 따라 진행 표시 방식을 다시 본다')
    for (const m of failed) console.log('  실패:', m)
  } else {
    console.log(`목표 안(첫 ${LIMIT.firstMs / 1000}초·다시 ${LIMIT.secondMs / 1000}초·RSS ${LIMIT.peakRssMb}MB 이하, peakRssMb ${peak})`)
  }
  process.exitCode = failed.length ? 1 : 0
})().catch((e) => { console.error(e.message); process.exit(1) })
