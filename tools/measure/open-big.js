'use strict'
// 완료 조건 4: BIG_200 첫 열기·다시 열기 시간과 서버 RSS 최고치(X-SE-Open-Stats). 서버(npm run dev)가 떠 있어야 한다.
const API = process.env.API || 'http://127.0.0.1:3100/api/scenario-editor'
const H = { 'X-SE-User': 'sew_master' }

async function openOnce() {
  const t = Date.now()
  const res = await fetch(`${API}/scenarios/SEWPHOTO/SEWMODELA/BIG_200/versions/current`, { headers: H })
  const body = await res.json()
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${JSON.stringify(body)}`)
  return { wallMs: Date.now() - t, stats: res.headers.get('x-se-open-stats'), steps: body.data.steps.length, bytes: JSON.stringify(body).length }
}

;(async () => {
  await fetch(`${API}/cache/refresh?images=1`, { method: 'POST', headers: H })
  const first = await openOnce()
  const second = await openOnce()
  console.log('첫 열기  :', first)
  console.log('다시 열기:', second)
  const ok = first.wallMs <= 30000 && second.wallMs <= 1000
  console.log(ok ? '목표 안(첫 30초·다시 1초)' : '목표 밖 — 설계 §2-4 에 따라 진행 표시 방식·흘려 읽기를 다시 본다')
  process.exitCode = ok ? 0 : 1
})().catch((e) => { console.error(e.message); process.exit(1) })
