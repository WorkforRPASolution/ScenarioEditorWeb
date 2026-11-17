'use strict'
// E2E 용 흉내 판정 서버(P4-C) — fake-vision-server.js 의 withJudge 를 따로 띄우고 제어 포트로 다룬다. client/playwright.config.js 가 webServer 로 띄운다.
// 뜰 때: 앞서 죽은 실행이 남긴 흉내 노드(host.docker.internal:…)를 지우고, 흉내를 띄워 전용 ZooKeeper(is-zookeeper)의 두 경로에 올린다.
// 내릴 때(SIGTERM·SIGINT): 노드를 지운다. 판정 통합 시험·실측 도구와 동시에 돌리지 않는다(서로의 노드를 지운다).
//   node tools/infra/fake-vision-judge-server.js --control 3196
// 제어(127.0.0.1 만):
//   GET  /health        → { judge: 'on'|'off', address }
//   PUT  /control       → 본문 JSON { delayMs, error, visionResults, ocrLines, ocrConfidence } 의 일부 — 흉내의 답을 바꾼다
//   POST /reset         → 제어 값을 처음으로, 받은 요청 기록을 비운다
//   GET  /calls         → 받은 요청 [{ rpc, bytes, cancelled, param }]
//   PUT  /judge/off·on  → 노드를 지웠다가 다시 올린다("판정 서버 없음" 상태 — 흉내는 떠 있다)
const http = require('node:http')
const { withJudge } = require('./fake-vision-server')
const { createIsZk } = require('./is-zk')

const HOST = 'host.docker.internal'
const KINDS = ['vision', 'ocr']
const MAX_BODY = 1024 * 1024

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}
async function sweep(zk) {
  for (const kind of KINDS) {
    for (const node of await zk.list(kind)) if (node.startsWith(`${HOST}:`)) await zk.remove(kind, node)
  }
}

async function startJudgeServer({ zk = createIsZk(), host = '127.0.0.1', controlPort = 0, noticeMs } = {}) {
  await sweep(zk)
  const judge = await withJudge({ zk, advertiseHost: HOST, kinds: KINDS, ...(noticeMs === undefined ? {} : { noticeMs }) })
  const { fake, address } = judge
  let on = true
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8' })
    res.end(JSON.stringify(body))
  }
  async function route(req, res) {
    const key = `${req.method} ${req.url}`
    if (key === 'GET /health') return reply(res, 200, { judge: on ? 'on' : 'off', address })
    if (key === 'GET /calls') return reply(res, 200, fake.calls)
    if (key === 'POST /reset') { fake.reset(); return reply(res, 200, { ok: true }) }
    if (key === 'PUT /control') {
      let partial
      try { partial = JSON.parse(await readBody(req)) } catch { partial = null }
      if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return reply(res, 400, { error: 'control must be a JSON object' })
      fake.set(partial)
      return reply(res, 200, { ok: true })
    }
    const m = /^PUT \/judge\/(on|off)$/.exec(key)
    if (m) {
      const want = m[1] === 'on'
      await Promise.all(KINDS.map((kind) => (want ? zk.add(kind, address) : zk.remove(kind, address))))
      on = want
      return reply(res, 200, { judge: on ? 'on' : 'off', address })
    }
    return reply(res, 404, { error: 'not found' })
  }
  const control = http.createServer((req, res) => {
    route(req, res).catch((e) => { if (!res.headersSent) reply(res, 500, { error: e.message }); else res.destroy() })
  })
  try {
    await listen(control, controlPort, host)
  } catch (e) {
    await judge.stop().catch(() => {})
    throw e
  }
  return {
    port: fake.port,
    address,
    controlUrl: `http://${host}:${control.address().port}`,
    async close() {
      try {
        await judge.stop()
      } finally {
        await new Promise((resolve) => { control.close(() => resolve()); control.closeAllConnections?.() })
      }
    }
  }
}

function parseArgs(argv) {
  const i = argv.indexOf('--control')
  const v = i >= 0 ? argv[i + 1] : undefined
  if (!/^\d+$/.test(v ?? '')) throw new Error(`--control <포트> 는 숫자여야 한다: ${v}`)
  return { controlPort: Number(v) }
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2))
  startJudgeServer(opts).then((srv) => {
    console.log(`fake-vision-judge ${srv.address} (제어 ${srv.controlUrl})`)
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      srv.close().then(() => process.exit(0), (e) => { console.error(`흉내 판정 서버 노드를 지우지 못했다: ${e.message}`); process.exit(1) })
    }
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
  }, (e) => {
    console.error(`흉내 판정 서버를 띄우지 못했다: ${e.message}`)
    process.exit(1)
  })
}

module.exports = { startJudgeServer, parseArgs }
