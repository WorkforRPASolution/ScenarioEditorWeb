'use strict'
// 시험용 InterfaceServer 중계(설계 §13.2 고장 주입). 통합 시험이 EARS_INTERFACE_URL 을 이 주소로 바꿔 끊김·늦음을 만든다.
// 모드
//   pass      — 그대로 중계한다.
//   down      — 듣는 소켓과 열린 연결을 닫는다. 연결이 거부된다(→ 503 UPSTREAM_DOWN). 다른 모드로 바꾸면 같은 포트로 다시 연다.
//   hang      — 본문을 받고 답하지 않는다. InterfaceServer 로 보내지 않는다(→ 504, 저장 안 됨).
//   slow500   — InterfaceServer 로 다 보내 답을 받은 뒤(저장이 끝난 뒤) 클라이언트에는 500(→ 504 결과 모름, 판은 저장됨).
//   dropAfter — InterfaceServer 로 다 보내 답을 받은 뒤 응답 없이 클라이언트 소켓을 끊는다(→ 504 결과 모름, 판은 저장됨).
// 모드는 요청을 받는 순간의 값을 쓴다 — 요청 도중에 바꿔도 그 요청은 처음 모드대로 끝난다.
const http = require('node:http')

const MODES = new Set(['pass', 'down', 'hang', 'slow500', 'dropAfter'])

async function startFaultProxy({ target, host = '127.0.0.1', port = 0 }) {
  const upstream = new URL(target)
  const sockets = new Set()
  let mode = 'pass'
  let server = null
  let boundPort = port

  function relay(req, res, onAnswer) {
    const up = http.request({
      hostname: upstream.hostname, port: upstream.port || 80, method: req.method, path: req.url,
      headers: { ...req.headers, host: upstream.host }
    }, onAnswer)
    // InterfaceServer 에 닿지 못하면 클라이언트도 끊는다(시험이 모르는 결과를 지어내지 않는다)
    up.on('error', () => res.destroy())
    req.pipe(up)
  }

  function handle(req, res) {
    const m = mode
    if (m === 'hang') { req.resume(); return }
    relay(req, res, (upRes) => {
      if (m === 'pass') {
        res.writeHead(upRes.statusCode, upRes.headers)
        upRes.pipe(res)
        return
      }
      // slow500·dropAfter: InterfaceServer 의 답을 끝까지 받은 뒤(저장이 끝난 뒤) 고장을 낸다
      upRes.resume()
      upRes.on('end', () => {
        if (m === 'slow500') {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' })
          res.end('There was an internal server error.')
        } else {
          req.socket.destroy()
        }
      })
    })
  }

  function listen() {
    return new Promise((resolve, reject) => {
      const s = http.createServer(handle)
      s.on('connection', (sock) => {
        sockets.add(sock)
        sock.on('close', () => sockets.delete(sock))
      })
      s.once('error', reject)
      s.listen(boundPort, host, () => {
        s.off('error', reject)
        boundPort = s.address().port
        server = s
        resolve()
      })
    })
  }

  // 듣기를 멈추고 열린 연결(쉬는 keep-alive·매달린 요청)도 끊는다 — 남은 연결로 요청이 들어오지 않게.
  function shut() {
    if (!server) return Promise.resolve()
    const s = server
    server = null
    return new Promise((resolve) => {
      s.close(() => resolve())
      for (const sock of sockets) sock.destroy()
    })
  }

  await listen()
  return {
    url: `http://${host}:${boundPort}`,
    async setMode(next) {
      if (!MODES.has(next)) throw new Error(`알 수 없는 중계 모드: ${next}`)
      const prev = mode
      mode = next
      if (next === 'down' && prev !== 'down') await shut()
      else if (next !== 'down' && prev === 'down') await listen()
    },
    async close() {
      mode = 'down'
      await shut()
    }
  }
}

module.exports = { startFaultProxy }
