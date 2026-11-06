// 단독판은 기본 127.0.0.1 에서만 받는다(인증 없는 서버가 EARS 쓰기 API 를 외부에 열지 않게).
function resolveListenAddress(env) {
  const port = Number.parseInt(env.PORT, 10)
  return {
    port: Number.isFinite(port) ? port : 3100,
    host: env.HOST && env.HOST.trim() !== '' ? env.HOST.trim() : '127.0.0.1'
  }
}

// 루프백 주소인가. 아니면 쓰기 API 를 막는다(app.js seWriteDisabled).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])
function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host).trim().toLowerCase())
}

module.exports = { resolveListenAddress, isLoopbackHost }
