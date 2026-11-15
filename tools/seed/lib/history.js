'use strict'
// 이력 시험 데이터 — 로컬 이력 서버(HttpWebServer)의 `POST /ARS/AppendHistory` 로 넣는다(사내에서 판정 서버가 넣는 길과 같다).
// - 이력 서버가 Cassandra `ars.historylog(eqpid, txn, step, body)` 에 HTML 조각으로 쓴다. 지우기는 Cassandra 에서 직접 한다.
// - `SEWT_` 설비 것만 넣고 지운다. 이력 서버 주소가 이 PC(루프백)가 아니면 넣지 않는다 — server/.env 에 사내 주소가 있어도 운영에 쓰지 않게.
const { parseEnv } = require('node:util')
const { PNG } = require('pngjs')
const D = require('../data/snapshots')
const H = require('../data/history')
const { partitionOf, kstMs, assertTestEquipment } = require('./snapshots')
const { readEnvFile } = require('./cassandra')

const Q_PARTITIONS = 'select distinct eqpid, txn from historylog'
const Q_DELETE = 'delete from historylog where eqpid = ? and txn = ?'

function solidPng([width, height], [r, g, b]) {
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height * 4; i += 4) {
    png.data[i] = r
    png.data[i + 1] = g
    png.data[i + 2] = b
    png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}

// 시험 태그 한 벌의 txn(첫 태그의 ms — planSnapshots 와 같은 값)에 스텝마다 한 줄
function planHistory(now) {
  const txn = kstMs(partitionOf(now), D.TODAY_TAGS[0][0])
  return H.STEPS.map(([step, text]) => ({
    eqpId: D.PHOTO, txn, step, text,
    screen: solidPng(H.SCREEN, [40 + step * 50, 120, 200 - step * 40]), screenSize: H.SCREEN,
    ref: solidPng(H.REF, [230, 60 + step * 40, 30]), refSize: H.REF
  }))
}

const text = (v) => (typeof v === 'string' ? v.trim() : '')
// processEnv = 환경 변수, fileText = server/.env 글(없으면 null). 비면 null — 부르는 쪽이 건너뛴다.
function historyUrl(processEnv = process.env, fileText = readEnvFile()) {
  const fromFile = typeof fileText === 'string' ? parseEnv(fileText).HTTP_WEB_SERVER_URL : ''
  return text(processEnv.HTTP_WEB_SERVER_URL) || text(fromFile) || null
}

function assertLocalHistoryServer(url) {
  let host = null
  try { host = new URL(url).hostname.toLowerCase() } catch { /* 아래에서 던진다 */ }
  const ok = host === 'localhost' || host === '[::1]' || (host !== null && /^127(\.\d{1,3}){3}$/.test(host))
  if (!ok) throw new Error(`시험 이력은 이 PC(루프백)의 이력 서버에만 넣습니다 — 루프백이 아닌 주소: ${host ?? '(읽을 수 없는 주소)'} (server/.env 의 HTTP_WEB_SERVER_URL)`)
}

async function seedHistory(url, rows, { fetch = globalThis.fetch } = {}) {
  assertLocalHistoryServer(url)
  assertTestEquipment(rows.map((r) => r.eqpId))
  const target = `${String(url).replace(/\/+$/, '')}/ARS/AppendHistory`
  for (const r of rows) {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostname: r.eqpId, txn: r.txn, step: r.step, text: r.text,
        image: r.screen.toString('base64'), imageWidth: r.screenSize[0], imageHeight: r.screenSize[1],
        refimage: r.ref.toString('base64'), refimageWidth: r.refSize[0], refimageHeight: r.refSize[1]
      }),
      signal: AbortSignal.timeout(15000)
    })
    const body = await res.text()
    // 이력 서버는 성공·실패 모두 200 에 (true,success)·(false,이유) 를 준다
    if (res.status !== 200 || !body.startsWith('(true')) throw new Error(`AppendHistory 실패: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return { steps: rows.length }
}

// historylog 의 파티션(설비·txn) 가운데 시험 설비 것만 지운다. 로컬 Cassandra 라 파티션 수가 적다.
async function cleanHistory(client, isTest = (id) => typeof id === 'string' && id.startsWith('SEWT_')) {
  const { rows } = await client.execute(Q_PARTITIONS, [], { prepare: true })
  let partitions = 0
  for (const row of rows) {
    if (!isTest(row.eqpid)) continue
    await client.execute(Q_DELETE, [row.eqpid, row.txn], { prepare: true })
    partitions++
  }
  return { partitions }
}

module.exports = { planHistory, seedHistory, cleanHistory, historyUrl, assertLocalHistoryServer }
