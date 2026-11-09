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

// 시작 로그에 남길 경고. 루프백이 아닌 HOST 면 쓰기 API 가 403 WRITE_DISABLED 다(app.js seWriteDisabled) — 뜨긴 하지만 저장·배포가 안 되는 까닭을 로그로 알린다.
function startupWarnings(env) {
  const { host } = resolveListenAddress(env)
  return isLoopbackHost(host) ? [] : [`HOST=${host} 는 루프백이 아니라 쓰기 API(저장·배포·켜기·끄기·삭제·심의·성과)가 403 WRITE_DISABLED 입니다. 이 PC 에서만 쓰려면 HOST 를 비우거나 127.0.0.1 로 두세요`]
}

module.exports = { resolveListenAddress, isLoopbackHost, startupWarnings }
