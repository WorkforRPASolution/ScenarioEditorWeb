'use strict'
// 스냅샷 서버 맞춤 확인 — 실제 ARSSnapShotServer 로 한 장 올리고(UPLOAD), 웹 API 의 목록·그림에 같은 이름·같은 바이트로 나오는지 본다.
// 웹은 스냅샷 서버를 거치지 않고 Cassandra 를 직접 읽는다(P3 설계 §14.1 ①) — 스냅샷 서버가 쓰는 파티션·값과 웹이 읽는 규칙이 맞는지의 확인이다.
// 스냅샷 서버의 DIR·GETFILE(데스크톱이 쓰는 길)도 불러 웹이 본 것과 같은지 견준다.
//
// 준비: tools/infra/prepare-ss.sh && docker compose -f infra/docker-compose.yml --profile ss up -d ss-zookeeper snapshot-server
//       웹 서버: SE_DEV_USER_OVERRIDE=1 npm --prefix server start   (시험 데이터 npm run seed -- reset basic anomaly)
// 끝나면 올린 줄을 Cassandra 에서 지운다. 하나라도 다르면 종료 코드 1.
const { PNG } = require('pngjs')
const { connectCassandra } = require('../seed/lib/cassandra')
const { removeSnapshots, partitionOf } = require('../seed/lib/snapshots')

const API = process.env.API || 'http://127.0.0.1:3100/api/scenario-editor'
const SS = process.env.SNAPSHOT_SERVER_URL || 'http://127.0.0.1:8081'
const H = { 'X-SE-User': 'sew_master' }
const EQP = 'SEWT_ETCH_B01'
const WAIT_MS = 15000

function makePng() {
  const png = new PNG({ width: 64, height: 48 })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i * 7) % 256
    png.data[i + 1] = (i * 3) % 256
    png.data[i + 2] = 90
    png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}

async function ss(funcType, body) {
  const res = await fetch(`${SS}/EARS/Snapshot`, { method: 'POST', headers: { FuncType: funcType, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`스냅샷 서버 ${funcType} HTTP ${res.status} ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: H })
  return res
}

const kstDate = (ms) => {
  const { year, month, day } = partitionOf(ms)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

;(async () => {
  const ms = Date.now()
  const fileName = `${ms}_[123][45].png`
  const png = makePng()
  const date = kstDate(ms)
  const { year, month } = partitionOf(ms)
  const row = { eqpId: EQP, fileName, ms, png }
  const checks = []
  const check = (name, pass, detail = '') => { checks.push(pass); console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
  let cassandra = null
  try {
    const up = await ss('UPLOAD', { hostname: EQP, filename: fileName, image: png.toString('base64') })
    check('스냅샷 서버 UPLOAD', up.result === 'Success', JSON.stringify(up))

    // 스냅샷 서버는 답을 먼저 주고 비동기로 쓴다 — 웹 목록에 나올 때까지 기다린다.
    const t0 = Date.now()
    let item = null
    while (!item && Date.now() - t0 < WAIT_MS) {
      const res = await api(`/snapshots?eqpId=${EQP}&date=${date}`)
      if (res.status !== 200) throw new Error(`웹 목록 HTTP ${res.status} ${await res.text()}`)
      item = (await res.json()).data.items.find((i) => i.fileName === fileName) || null
      if (!item) await new Promise((r) => setTimeout(r, 300))
    }
    check('웹 하루 목록에 같은 이름', !!item, item ? `${Date.now() - t0}ms 뒤, 표시 ${date} ${item.time} ${item.shift}` : `${WAIT_MS}ms 안에 나오지 않음`)
    if (item) check('웹 목록 해석', item.kind === 'click' && item.x === 123 && item.y === 45 && item.ms === ms, JSON.stringify({ kind: item.kind, x: item.x, y: item.y }))

    const days = await (await api(`/snapshots/days?eqpId=${EQP}&counts=1`)).json()
    check('웹 있는 날', days.data.latest === date && days.data.days[date] >= 1, JSON.stringify(days.data))

    const img = await api(`/snapshots/${encodeURIComponent(EQP)}/${encodeURIComponent(fileName)}/image`)
    const bytes = Buffer.from(await img.arrayBuffer())
    check('웹 그림이 올린 바이트와 같다', img.status === 200 && bytes.equals(png), `HTTP ${img.status}, ${bytes.length}바이트, ${img.headers.get('cache-control')}`)

    const dir = await ss('DIR', { hostname: EQP, year, month })
    check('스냅샷 서버 DIR(데스크톱 길)에도 같은 이름', dir.result === 'Success' && dir.filelist.includes(fileName), `${year}-${month} ${dir.filelist.length}줄`)
    const got = await ss('GETFILE', { hostname: EQP, year, month, filename: fileName })
    check('스냅샷 서버 GETFILE 그림이 웹 그림과 같다', got.result === 'Success' && Buffer.from(got.img, 'base64').equals(bytes))
  } finally {
    try {
      cassandra = await connectCassandra()
      if (cassandra) await removeSnapshots(cassandra, [row])
      console.log(cassandra ? '올린 줄을 지움' : '지우지 못함: server/.env 에 CASSANDRA_CONTACT_POINTS 가 없음')
    } finally {
      if (cassandra) await cassandra.shutdown()
    }
  }
  if (!checks.length || checks.includes(false)) process.exit(1)
})().catch((e) => { console.error(`실패: ${e.message}`); process.exit(1) })
