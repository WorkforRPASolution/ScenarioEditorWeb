'use strict'
// 고장 주입 중계(fault-proxy.js)를 따로 띄우고 제어 포트로 모드를 바꾼다 — E2E(client/playwright.config.js)가 webServer 로 띄운다.
// 시험 서버(3100)의 EARS_INTERFACE_URL 을 중계 주소로 두므로 모든 E2E 가 중계를 거친다. 처음과 평소는 pass(그대로 중계),
// 결과 모름 E2E 만 잠깐 slow500 으로 바꿨다가 되돌린다.
//   node tools/infra/fault-proxy-server.js --target http://localhost:8080 --port 3197 --control 3198
// 제어(127.0.0.1 만): GET /health → {"mode":"pass"} · PUT /mode/<pass|down|hang|slow500|dropAfter> → {"mode":…}, 모르는 모드는 400.
const http = require('node:http')
const { startFaultProxy } = require('./fault-proxy')

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })
}

async function startFaultProxyServer({ target, host = '127.0.0.1', port = 0, controlPort = 0 }) {
  const proxy = await startFaultProxy({ target, host, port })
  let mode = 'pass'
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8' })
    res.end(JSON.stringify(body))
  }
  const control = http.createServer((req, res) => {
    req.resume()
    const m = /^\/mode\/([A-Za-z0-9]+)$/.exec(req.url)
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { mode })
    if (req.method === 'PUT' && m) {
      proxy.setMode(m[1]).then(() => { mode = m[1]; reply(res, 200, { mode }) }, (e) => reply(res, 400, { error: e.message, mode }))
      return undefined
    }
    return reply(res, 404, { error: 'not found' })
  })
  await listen(control, controlPort, host)
  return {
    url: proxy.url,
    controlUrl: `http://${host}:${control.address().port}`,
    async close() {
      await proxy.close()
      await new Promise((resolve) => { control.close(() => resolve()); control.closeAllConnections?.() })
    }
  }
}

function parseArgs(argv) {
  const get = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const target = get('--target')
  if (!target) throw new Error('--target <InterfaceServer 주소> 가 필요하다')
  const num = (name) => {
    const v = get(name)
    if (!/^\d+$/.test(v ?? '')) throw new Error(`${name} <포트> 는 숫자여야 한다: ${v}`)
    return Number(v)
  }
  return { target, port: num('--port'), controlPort: num('--control') }
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2))
  startFaultProxyServer(opts).then((srv) => {
    console.log(`fault-proxy ${srv.url} → ${opts.target} (제어 ${srv.controlUrl})`)
    const stop = () => srv.close().then(() => process.exit(0))
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
  }, (e) => {
    console.error(`fault-proxy 를 띄우지 못했다: ${e.message}`)
    process.exit(1)
  })
}

module.exports = { startFaultProxyServer, parseArgs }
