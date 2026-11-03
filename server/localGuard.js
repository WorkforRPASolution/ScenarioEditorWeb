'use strict'
// 단독판 전용: 로그인이 없어 들어온 요청을 모두 SE_USER_SINGLEID 로 처리하므로, 같은 PC 브라우저를 거쳐 오는 외부 페이지의 요청을 여기서 거른다.
// Host 허용 목록 = DNS rebinding, 쓰기 요청의 출처 검사 = CSRF. 편입 때 함께 사라진다 — WebManager 는 Bearer 토큰이라 브라우저가 자동으로 붙이지 않는다.
// 오류 처리기를 거치지 않고 바로 답한다 — 외부 페이지의 요청이 오류 기록(WebManagerLog)에 쌓이지 않게 한다.
const { createLogger } = require('./shared/logger')

const log = createLogger('server')

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]']
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SAME_ORIGIN_SITES = new Set(['same-origin', 'none'])

// 'localhost:3100' -> 'localhost', '[::1]:3100' -> '[::1]'. URL 로 해석해 'localhost@evil.example' 같은 꼴도 진짜 호스트(evil.example)로 본다.
function hostnameOf(hostHeader) {
  if (!hostHeader) return null
  try {
    return new URL(`http://${hostHeader}`).hostname
  } catch {
    return null
  }
}

function createLocalGuard({ allowedOrigins, allowedHosts }) {
  const extra = String(allowedHosts ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  const hosts = new Set([...DEFAULT_HOSTS, ...extra])

  const reject = (req, res, code, error) => {
    log.warn(`${code} ${req.method} ${req.originalUrl ?? req.url} host=${req.headers.host} origin=${req.headers.origin}`)
    res.status(403).json({ error, code })
  }

  return function localGuard(req, res, next) {
    if (!hosts.has(hostnameOf(req.headers.host))) return reject(req, res, 'HOST_FORBIDDEN', '허용되지 않은 Host 입니다')
    if (SAFE_METHODS.has(req.method)) return next()
    const { origin } = req.headers
    const site = req.headers['sec-fetch-site']
    // 브라우저는 다른 출처의 쓰기 요청에 Origin 을 붙인다. 둘 다 없으면 브라우저가 아닌 도구다.
    const allowed = origin !== undefined ? allowedOrigins.includes(origin) : site === undefined || SAME_ORIGIN_SITES.has(site)
    if (!allowed) return reject(req, res, 'ORIGIN_FORBIDDEN', '허용되지 않은 출처의 쓰기 요청입니다')
    next()
  }
}

module.exports = { createLocalGuard }
