'use strict'
// 사내 쓰기 시험(P2-E) 사전 점검 — 단독판을 사내 운영 EARS 에 붙여 저장·배포하기 전에 server/.env 를 본다(설계 §12, README "사내 쓰기 시험").
// 쓰기: node tools/inhouse/preflight.js [--env server/.env] [--name SEW_TEST_yyyyMMdd --process <공정> --model <모델>]
// 멈춤이 하나라도 있으면 종료 코드 1. 서버가 떠 있으면 쓰기 권한(/me)을, --name 을 주면 이름 규칙(/name-rule)과 그 이름이 이미 있는지(/scenarios)도 본다.
// InterfaceServer 는 이 PC 에서 연결되는지만 본다(TCP 연결을 열었다 닫는다 — 요청은 보내지 않는다).
// 스냅샷·이력(P3 설계 §13, 구역 [10])도 본다 — 설정의 꼴, 이 PC 에서 Cassandra·이력 서버에 연결되는지(TCP 만), 서버가 떠 있으면
// 서버를 거쳐 실제로 한 번 조회해 본다(계정·데이터센터 이름까지 — 이 도구가 Cassandra 에 직접 붙지는 않는다). 읽기만 하는 기능이라 모두 경고다.
// tools 의 패키지를 쓰지 않는다 — 사내 PC 는 tools 를 설치하지 않으므로 Node 내장과 server 의 dotenv·순수 모듈만 부른다.
const { readFileSync, existsSync } = require('node:fs')
const net = require('node:net')
const { join, resolve } = require('node:path')
const { createRequire } = require('node:module')
const { isLoopbackHost, resolveListenAddress } = require('../../server/listen')
const { mongoDbName, sameDbName } = require('../../server/mongoUri')

const ROOT = join(__dirname, '../..')
const DEFAULT_EARS_URI = 'mongodb://localhost:27017/EARS' // 서버 연결 코드의 기본값
const DEFAULT_IMAGE_CACHE_DIRS = new Set(['', './.cache/images', '.cache/images'])
const TEST_NAME = /^SEW_TEST_\d{8}(_\d+)?$/
// 서버가 이 값 뒤에 /EARS/Interface 를 붙여 부른다 — http(s)://호스트[:포트] 까지만이어야 한다
const INTERFACE_URL = /^https?:\/\/[^/?#\s]+$/i

const blank = (v) => typeof v !== 'string' || v.trim() === ''
const stop = (code, message) => ({ level: 'stop', code, message })
const warn = (code, message) => ({ level: 'warn', code, message })

// 설정 점검. 문구에는 주소 대신 DB 이름·호스트만 싣는다(계정·비밀번호가 화면·기록에 남지 않게).
function checkEnv(env) {
  const out = []
  const { host } = resolveListenAddress(env)
  if (!isLoopbackHost(host)) out.push(stop('HOST_NOT_LOOPBACK', `HOST=${host} — 인증 없는 서버라 이 PC 안에서만 받아야 한다. HOST 를 127.0.0.1 로 둔다(이대로 띄우면 쓰기 API 가 403 WRITE_DISABLED)`))
  if (env.SE_WEBMANAGER_DB !== '0') out.push(stop('WEBMANAGER_DB_ON', 'SE_WEBMANAGER_DB 가 0 이 아니다 — 운영 Mongo 에 WebManager 기록을 쓴다. SE_WEBMANAGER_DB=0 으로 둔다'))
  if (blank(env.SE_WEB_DB_URI)) {
    out.push(stop('WEB_DB_MISSING', 'SE_WEB_DB_URI 가 비었다 — 초안·배포 기록을 둘 웹 전용 DB 가 없어 저장·배포가 503 이다. 사내 WebManager 의 WEBMANAGER_DB_URI 값을 넣는다(README "사내 쓰기 시험" 3)'))
  } else if (mongoDbName(env.SE_WEB_DB_URI) === '') {
    out.push(stop('WEB_DB_NAME_MISSING', 'SE_WEB_DB_URI 에 DB 이름이 없다 — 드라이버가 test DB 에 쓴다. 주소 끝에 /WEB_MANAGER 처럼 DB 이름을 넣는다'))
  } else if (sameDbName(env.SE_WEB_DB_URI, env.MONGODB_URI || DEFAULT_EARS_URI)) {
    out.push(stop('WEB_DB_SAME_AS_EARS', `SE_WEB_DB_URI 의 DB 이름(${mongoDbName(env.SE_WEB_DB_URI)})이 운영 EARS(MONGODB_URI)와 같다 — 초안·배포 기록이 운영 EARS 에 생긴다. 다른 DB 이름을 쓴다(서버도 이대로는 뜨지 않는다)`))
  }
  if (blank(env.EARS_INTERFACE_URL)) out.push(stop('INTERFACE_URL_MISSING', 'EARS_INTERFACE_URL 이 비었다 — 배포할 곳이 없다. 사내 InterfaceServer 주소를 넣는다'))
  else if (!interfaceTarget(env)) out.push(stop('INTERFACE_URL_FORMAT', 'EARS_INTERFACE_URL 은 http://<호스트>:<포트> 꼴이어야 한다 — 앞에 http:// 가 없거나, 뒤에 경로(/EARS/Interface)나 / 가 붙었다. 서버가 뒤에 /EARS/Interface 를 붙여 부른다. 이대로면 배포가 "저장 서버에 연결하지 못했습니다" 나 거절로 끝난다'))
  if (blank(env.SE_USER_SINGLEID)) out.push(stop('USER_MISSING', 'SE_USER_SINGLEID 가 비었다 — 본인 SingleID(WRITE 권한)를 넣는다'))
  if (env.SE_DEV_USER_OVERRIDE === '1') out.push(stop('DEV_USER_OVERRIDE_ON', 'SE_DEV_USER_OVERRIDE=1 — 브라우저에서 다른 사용자로 바꿔 저장할 수 있다. 0 으로 둔다'))
  if (DEFAULT_IMAGE_CACHE_DIRS.has(String(env.IMAGE_CACHE_DIR ?? '').trim())) {
    out.push(warn('IMAGE_CACHE_DEFAULT', 'IMAGE_CACHE_DIR 이 기본값(server\\.cache\\images) — 운영 시나리오의 기준 화면이 저장소 폴더 안에 쌓인다(상한 IMAGE_CACHE_MAX_MB). 디스크 여유를 보고, 다른 곳에 두려면 경로를 넣는다'))
  }
  return out
}

// URL 의 연결할 호스트·포트. IPv6 주소는 대괄호를 뗀다(대괄호째 붙으면 이름으로 찾다 ENOTFOUND 가 된다).
const urlTarget = (url) => ({ host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) })

// EARS_INTERFACE_URL 의 호스트·포트. 꼴이 틀리면 null.
function interfaceTarget(env) {
  const raw = String(env.EARS_INTERFACE_URL ?? '').trim()
  if (!INTERFACE_URL.test(raw)) return null
  let url
  try { url = new URL(raw) } catch { return null }
  return urlTarget(url)
}

const CONNECT_TIMEOUT_MS = 3000

// TCP 연결을 열었다 바로 닫는다. 되면 null, 안 되면 오류 코드(ENOTFOUND·ECONNREFUSED·TIMEOUT …).
function tcpConnect(host, port, timeoutMs) {
  return new Promise((done) => {
    const socket = net.connect({ host, port })
    const end = (result) => { socket.destroy(); done(result) }
    socket.setTimeout(timeoutMs, () => end('TIMEOUT'))
    socket.once('connect', () => end(null))
    socket.once('error', (e) => end((e && e.code) || 'ERROR'))
  })
}

const UNREACHABLE_WHY = {
  ENOTFOUND: '이 PC 에서 그 이름을 찾지 못한다(쿠버네티스 안쪽 이름이면 PC 에서는 닿지 않는다)',
  EAI_AGAIN: '이 PC 에서 그 이름을 찾지 못한다(쿠버네티스 안쪽 이름이면 PC 에서는 닿지 않는다)',
  ECONNREFUSED: '그 포트에서 받는 서버가 없다(호스트·포트를 본다)'
}

// InterfaceServer 에 이 PC 에서 연결되는가. 주소가 없거나 꼴이 틀리면 보지 않는다(checkEnv 가 이미 멈춘다).
async function interfaceCheck({ env, connect = tcpConnect }) {
  const target = interfaceTarget(env)
  if (!target) return []
  const code = await connect(target.host, target.port, CONNECT_TIMEOUT_MS)
  if (code === null) return []
  const why = UNREACHABLE_WHY[code] ?? '응답이 없다(주소가 틀렸거나 방화벽에 막혔다)'
  return [stop('INTERFACE_UNREACHABLE', `InterfaceServer ${target.host}:${target.port} 에 연결하지 못했다(${code}) — ${why}. 이대로면 배포가 "저장 서버에 연결하지 못했습니다" 로 끝난다. 이 PC 의 데스크톱 편집기가 쓰는 주소로 바꾼다(README "사내 쓰기 시험" 3)`)]
}

// ── 스냅샷·이력(구역 [10]) ──
// 서버 repo/snapshotRepository.js·clients/historyClient.js·cassandra-driver 가 읽는 방식과 맞춘다:
// - 주소는 쉼표로 나눈 호스트. 드라이버는 host:port·[ipv6]:port 도 풀고 그 포트를 CASSANDRA_PORT 보다 앞세운다(control-connection.js).
// - CASSANDRA_PORT 는 비었거나 숫자가 아니면 9042, 숫자면 그대로(범위 밖이면 붙다가 실패한다).
// - 계정은 둘 다 있을 때만 보낸다(비밀번호는 다듬지 않는다).
// - 이력 주소는 http(s):// 로 시작해야 하고 끝의 / 를 뗀 뒤 /ARS/History/… 를 붙인다(앞에 경로가 있어도 된다).
// 문구에 설정 값을 되찍지 않는다 — 틀린 자리에 계정·비밀번호가 들어 있을 수 있다(연결해 본 호스트·포트만 싣는다).
const HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const text = (v) => (typeof v === 'string' ? v.trim() : '')
const validPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535
const cassandraPoints = (env) => text(env.CASSANDRA_CONTACT_POINTS).split(',').map((s) => s.trim()).filter(Boolean)
const cassandraPort = (env) => (/^\d+$/.test(text(env.CASSANDRA_PORT)) ? Number(text(env.CASSANDRA_PORT)) : 9042)

// 주소 하나 → { host, port }(port 는 주소에 붙인 것, 없으면 null). 호스트 꼴이 아니면 null.
function parsePoint(name) {
  let host = name
  let port = null
  if (name.startsWith('[') && name.indexOf(']:') > 1) {
    const i = name.lastIndexOf(']:')
    host = name.slice(1, i)
    port = name.slice(i + 2)
  } else if (name.indexOf(':') > 0 && name.split(':').length === 2) {
    [host, port] = name.split(':')
  }
  if (net.isIP(host) === 0 && !HOSTNAME.test(host)) return null
  if (port === null) return { host, port: null }
  return /^\d+$/.test(port) && validPort(Number(port)) ? { host, port: Number(port) } : null
}

// HTTP_WEB_SERVER_URL → 비었으면 null, 틀렸으면 { problem }, 맞으면 { host, port }
function historyUrl(env) {
  const raw = text(env.HTTP_WEB_SERVER_URL)
  if (raw === '') return null
  if (!/^https?:\/\//i.test(raw)) return { problem: '앞에 http:// (또는 https://)가 없다' }
  let url
  try { url = new URL(raw) } catch { return { problem: '주소로 읽지 못한다(포트는 숫자여야 한다)' } }
  if (url.username || url.password) return { problem: '주소에 계정을 넣었다 — 서버가 그런 주소로는 요청을 보내지 못한다' }
  if (url.search || url.hash) return { problem: '뒤에 ? 나 # 이 붙었다' }
  if (/\/ARS\/History\/*$/i.test(url.pathname)) return { problem: '뒤에 /ARS/History 가 붙었다' }
  return urlTarget(url)
}

// 설정 점검. 스냅샷·이력은 읽기만 한다 — 틀려도 운영 데이터를 바꾸지 않으므로 모두 경고다.
function checkSnapshotEnv(env) {
  const points = cassandraPoints(env)
  if (!points.length) return [warn('SNAPSHOT_UNSET', 'CASSANDRA_CONTACT_POINTS 가 비었다 — 스냅샷 패널은 "주소가 설정되지 않았습니다" 만 보인다. 스냅샷을 쓰지 않는 시험이면 그대로 둔다(쓰려면 README 설정 표의 구역 [10])')]
  const out = []
  const bad = points.map((v, i) => (parsePoint(v) ? 0 : i + 1)).filter(Boolean)
  if (bad.length) out.push(warn('CASSANDRA_POINTS_FORMAT', `CASSANDRA_CONTACT_POINTS 의 ${bad.join('·')}번째 값이 호스트 꼴이 아니다 — 호스트 이름이나 IP 만 쉼표로 잇는다(cql:// 같은 머리·계정·경로를 붙이지 않는다)`))
  const rawPort = text(env.CASSANDRA_PORT)
  if (rawPort !== '' && !/^\d+$/.test(rawPort)) out.push(warn('CASSANDRA_PORT_FORMAT', 'CASSANDRA_PORT 가 숫자가 아니다 — 서버는 말없이 9042 로 붙는다. 포트 숫자만 적는다'))
  else if (!validPort(cassandraPort(env))) out.push(warn('CASSANDRA_PORT_FORMAT', 'CASSANDRA_PORT 가 1~65535 밖이다 — 서버가 그 포트로 붙으려다 실패한다'))
  const password = typeof env.CASSANDRA_PASSWORD === 'string' ? env.CASSANDRA_PASSWORD : ''
  if ((text(env.CASSANDRA_USERNAME) === '') !== (password === '')) out.push(warn('CASSANDRA_CREDENTIALS_HALF', 'CASSANDRA_USERNAME 과 CASSANDRA_PASSWORD 가운데 하나만 있다 — 서버는 둘 다 있을 때만 계정을 보낸다(이대로면 계정 없이 붙는다). 비밀번호에 # 이 있으면 값을 따옴표로 감싼다(.env 는 # 뒤를 버린다)'))
  const history = historyUrl(env)
  if (!history) out.push(warn('HISTORY_UNSET', 'HTTP_WEB_SERVER_URL 이 비었다 — 스냅샷의 [이력 보기] 만 "주소가 설정되지 않았습니다" 로 나온다. 이력을 보지 않으면 그대로 둔다'))
  else if (history.problem) out.push(warn('HISTORY_URL_FORMAT', `HTTP_WEB_SERVER_URL 은 http://<호스트>:<포트> 꼴이어야 한다 — ${history.problem}. 서버가 뒤에 /ARS/History/… 를 붙여 부른다`))
  return out
}

// 이 PC 에서 Cassandra 주소들과 이력 서버에 연결되는가(TCP 만 — 계정·데이터센터 이름은 snapshotRemoteChecks 가 서버를 거쳐 본다).
// 꼴이 틀린 값에는 붙어 보지 않는다(checkSnapshotEnv 가 이미 알린다). 꼴이 맞는 나머지에는 붙어 본다.
async function snapshotConnectCheck({ env, connect = tcpConnect }) {
  const points = cassandraPoints(env)
  if (!points.length) return []
  const fallback = cassandraPort(env)
  const targets = points.map(parsePoint).filter(Boolean).map((t) => ({ host: t.host, port: t.port ?? fallback })).filter((t) => validPort(t.port))
  const history = historyUrl(env)
  const historyTarget = history && !history.problem ? history : null
  const [nodes, historyCode] = await Promise.all([
    Promise.all(targets.map(async (t) => ({ ...t, code: await connect(t.host, t.port, CONNECT_TIMEOUT_MS) }))),
    historyTarget ? connect(historyTarget.host, historyTarget.port, CONNECT_TIMEOUT_MS) : null
  ])
  const out = []
  const failed = nodes.filter((n) => n.code !== null)
  const listed = failed.map((n) => `${n.host}:${n.port}(${n.code})`).join(', ')
  if (failed.length && failed.length === nodes.length) {
    out.push(warn('CASSANDRA_UNREACHABLE', `Cassandra 에 이 PC 에서 연결하지 못했다 — ${listed}. 이대로면 스냅샷 패널이 "스냅샷 저장소가 응답하지 않습니다" 로 나온다. 호스트·포트·방화벽을 본다(쿠버네티스 안쪽 이름이면 PC 에서는 닿지 않는다)`))
  } else if (failed.length) {
    out.push(warn('CASSANDRA_POINT_UNREACHABLE', `Cassandra 주소 ${nodes.length}개 가운데 ${failed.length}개에 연결하지 못했다 — ${listed}. 나머지로 붙으므로 스냅샷은 보이지만, 닿지 않는 주소는 빼 둔다`))
  }
  if (historyTarget && historyCode !== null) {
    const why = UNREACHABLE_WHY[historyCode] ?? '응답이 없다(주소가 틀렸거나 방화벽에 막혔다)'
    out.push(warn('HISTORY_UNREACHABLE', `이력 서버 ${historyTarget.host}:${historyTarget.port} 에 연결하지 못했다(${historyCode}) — ${why}. 이대로면 [이력 보기] 가 "이력 서버에 연결하지 못했습니다" 로 나온다`))
  }
  return out
}

// 시험 시나리오 이름. 다른 시나리오에 쓰지 않게 SEW_TEST_yyyyMMdd(_n) 만 받는다(계획 Global Constraints).
// ── Vision·OCR 시험(구역 [6], P4) ──
// 모두 경고다 — 주소가 비면 시험만 꺼지고, 나머지 값이 틀리면 서버가 기본값으로 돈다. 쓰기 시험을 막지 않는다.
// 서버(clients/visionClient.js)가 받는 꼴과 맞춘다: `호스트:포트`(스킴·계정·경로 없음), IPv6 는 [주소]:포트. 문구에 설정 값을 되찍지 않는다.
const GRPC_ADDR = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9._-]*):(\d{1,5})$/
const GRPC_DEFAULT_TIMEOUT_MS = 12000
const GRPC_RELAY_WAIT_MS = 10000 // InterfaceServer 가 판정 서버를 기다리는 시간

function visionTarget(env) {
  const m = GRPC_ADDR.exec(text(env.EARS_INTERFACE_GRPC_ADDR))
  if (!m || !validPort(Number(m[2]))) return null
  return { host: m[1].replace(/^\[(.*)\]$/, '$1'), port: Number(m[2]) }
}

function checkVisionEnv(env) {
  if (text(env.EARS_INTERFACE_GRPC_ADDR) === '') {
    return [warn('VISION_UNSET', 'EARS_INTERFACE_GRPC_ADDR 가 비었다 — Vision·OCR 시험만 "판정 시험 주소가 설정되지 않았습니다" 로 나온다. 시험을 쓰지 않으면 그대로 둔다(쓰려면 데스크톱 편집기의 Vision 시험 패널에 보이는 서버 주소 <호스트>:<포트> 를 넣는다)')]
  }
  const out = []
  const target = visionTarget(env)
  if (!target) {
    out.push(warn('VISION_ADDR_FORMAT', 'EARS_INTERFACE_GRPC_ADDR 은 <호스트>:<포트> 꼴이어야 한다 — http:// 같은 머리·계정·경로를 붙이지 않고, 포트는 1~65535. 이대로면 시험이 "중계 서버에 연결하지 못했습니다" 로 끝난다'))
  } else {
    const http = interfaceTarget(env)
    if (http && http.host.toLowerCase() === target.host.toLowerCase() && http.port === target.port) {
      out.push(warn('VISION_ADDR_SAME_AS_HTTP', 'EARS_INTERFACE_GRPC_ADDR 가 EARS_INTERFACE_URL 과 같은 호스트·포트다 — 저장(HTTP) 포트와 판정(gRPC) 포트는 다르다. 데스크톱 편집기의 Vision 시험 패널에 보이는 서버 주소의 포트를 넣는다'))
    }
  }
  const rawTimeout = text(env.EARS_INTERFACE_GRPC_TIMEOUT_MS)
  if (rawTimeout !== '') {
    const ms = Number(rawTimeout)
    if (!(Number.isFinite(ms) && ms > 0)) out.push(warn('VISION_TIMEOUT_FORMAT', `EARS_INTERFACE_GRPC_TIMEOUT_MS 가 양수가 아니다 — 서버는 말없이 ${GRPC_DEFAULT_TIMEOUT_MS} 으로 돈다. ms 숫자만 적는다`))
    else if (ms <= GRPC_RELAY_WAIT_MS) out.push(warn('VISION_TIMEOUT_SHORT', `EARS_INTERFACE_GRPC_TIMEOUT_MS 가 ${GRPC_RELAY_WAIT_MS} 이하다 — InterfaceServer 는 판정 서버를 10초까지 기다린다. 그보다 짧으면 판정 서버가 늦을 때 까닭("판정 서버가 10초 안에 답하지 않았습니다") 대신 "응답 시간이 초과됐습니다" 만 나온다. ${GRPC_DEFAULT_TIMEOUT_MS} 을 권한다`))
  }
  const rawCount = text(env.SE_VISION_TEST_CONCURRENCY)
  if (rawCount !== '' && !(/^\d+$/.test(rawCount) && Number(rawCount) >= 1 && Number(rawCount) <= 16)) {
    out.push(warn('VISION_CONCURRENCY_FORMAT', 'SE_VISION_TEST_CONCURRENCY 가 1~16 의 정수가 아니다 — 서버는 말없이 2 로 돈다'))
  }
  return out
}

// 주소가 비었거나 꼴이 틀리면 묻지 않는다(checkVisionEnv 가 알린다).
async function visionConnectCheck({ env, connect = tcpConnect }) {
  const target = visionTarget(env)
  if (!target) return []
  const code = await connect(target.host, target.port, CONNECT_TIMEOUT_MS)
  if (!code) return []
  const why = UNREACHABLE_WHY[code] ?? '이 PC 에서 닿지 않는다'
  return [warn('VISION_UNREACHABLE', `판정 시험 창구 ${target.host}:${target.port} 에 연결하지 못했다(${code}) — ${why}. 이대로면 Vision·OCR 시험이 "중계 서버에 연결하지 못했습니다" 로 끝난다. 데스크톱 편집기의 Vision 시험 패널에 보이는 서버 주소와 견준다`)]
}

function checkName({ name, process, model }) {
  if (name === undefined) return []
  if (!TEST_NAME.test(name)) return [stop('NAME_FORMAT', `--name ${name} — 시험 이름은 SEW_TEST_yyyyMMdd 또는 SEW_TEST_yyyyMMdd_2 꼴만 쓴다`)]
  if (blank(process) || blank(model)) return [stop('NAME_TARGET_MISSING', '--name 을 보려면 --process 와 --model 을 함께 준다(새 시나리오를 만들 공정·모델)')]
  return []
}

// 이미 있는 이름 다음 후보: SEW_TEST_20261110 → _2, SEW_TEST_20261110_2 → _3
function nextName(name) {
  const m = /^(SEW_TEST_\d{8})(?:_(\d+))?$/.exec(name)
  return m ? `${m[1]}_${m[2] ? Number(m[2]) + 1 : 2}` : 'SEW_TEST_yyyyMMdd_2'
}

const errorCode = async (res) => {
  try { const b = await res.json(); return b?.code ?? '' } catch { return '' }
}

const TIMEOUT_MS = 5000 // 묻는 요청 하나의 시간 제한 — 응답 없는 서버에 매달리지 않는다

// 이름 규칙이 있는가 — 화면 editor/nameRule nameRuleOf 와 같은 판정(대분류·중분류가 둘 다 있어야 규칙이다)
const hasNameRule = (res) => res?.exists === true && Array.isArray(res.rules) &&
  ['1', '2'].every((lv) => res.rules.some((r) => r && String(r.groupLevel) === lv && typeof r.name === 'string' && r.name !== ''))

// 떠 있는 서버에 묻는다. 서버에 닿지 않으면 나머지는 보지 않는다 — 이름 없이 돌릴 때(서버를 띄우기 전 첫 실행)는 경고,
// --name 을 주었으면 보라고 한 쓰기 권한·이름을 못 봤으므로 멈춤.
async function remoteChecks({ api, fetch, name, process, model }) {
  const get = async (path) => {
    try { return await fetch(`${api}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }) } catch { return null }
  }
  const named = name !== undefined && !blank(process) && !blank(model)
  const down = () => (named ? stop : warn)('SERVER_DOWN', `${api} 에 닿지 않는다 — 쓰기 권한·시험 이름·스냅샷 조회는 보지 않았다. 서버(npm run dev)를 띄운 창은 두고 새 명령 프롬프트 창에서 다시 돌린다`)
  const me = await get('/me')
  if (!me) return [down()]
  if (me.status !== 200) return [stop('ME_FAILED', `사용자 조회가 ${me.status} ${await errorCode(me)} — SE_USER_SINGLEID 가 운영 ARS_USER_INFO 에 있는지 본다`)]
  const user = (await me.json())?.data ?? {}
  const out = []
  if (user.canWrite !== true) out.push(stop('CANNOT_WRITE', `${user.singleid ?? 'SE_USER_SINGLEID'} 에 쓰기(WRITE) 권한이 없다 — 저장·배포가 막힌다. WRITE 권한이 있는 본인 계정을 쓴다`))
  if (!named) return out
  const rule = await get('/name-rule')
  if (!rule) return [...out, down()]
  if (rule.status !== 200) out.push(warn('NAME_RULE_UNKNOWN', `이름 규칙 조회가 ${rule.status} ${await errorCode(rule)} — 새 시나리오 창에 이름 칸이 없으면 README "이름 규칙이 있을 때" 를 따른다`))
  else if (hasNameRule((await rule.json())?.data)) out.push(warn('NAME_RULE', `이름 규칙이 있다 — 새 시나리오 창에서 ${name} 을 칠 수 없다. README "사내 쓰기 시험" 절차 2번의 "이름 규칙이 있을 때" 대로 저장 창에서 이름을 바꾼다`))
  const list = await get(`/scenarios?${new URLSearchParams({ process, model })}`)
  if (!list) return [...out, down()]
  if (list.status !== 200) return [...out, stop('LIST_FAILED', `${process}·${model} 목록 조회가 ${list.status} ${await errorCode(list)} — 공정·모델 이름과 권한을 본다`)]
  const rows = (await list.json())?.data ?? []
  if (rows.some((r) => r.name === name)) {
    out.push(stop('NAME_EXISTS', `${process}·${model} 에 ${name} 이 이미 있다 — 덮어쓰지 않는다. 다른 접미사를 쓴다(예: ${nextName(name)})`))
  }
  return out
}

// 서버가 스냅샷·이력을 묻고 답하기까지의 시간 제한 — 서버의 Cassandra 제한(연결 5초 + 읽기 10초)·이력 서버 제한(15초)보다 길게
const SNAPSHOT_TIMEOUT_MS = 20000
// 이력 번호 가운데 가장 작은 값 — 없으면 이력 서버가 "없다" 고 답한다. 닿고 읽힌다는 것만 본다
const PROBE_TXN = '99999'
const SERVER_LOG = '원인은 서버를 띄운 창의 로그에 남는다'
// 서버는 뜬 때의 설정을 쓴다 — .env 만 고치고 다시 돌리면 같은 경고가 나온다
const RESTART = '.env 를 고쳤으면 서버를 다시 띄운 뒤 다시 돌린다'
const SNAPSHOT_FAILURES = {
  SNAPSHOT_DOWN: ['SNAPSHOT_DOWN', `서버가 Cassandra 에 연결하지 못했다 — 위에 Cassandra 주소·포트 경고가 없으면 계정·비밀번호나 CASSANDRA_LOCAL_DC(운영 cqlsh 의 select data_center from system.local; 값)가 틀렸다. 비밀번호에 # 이 있으면 값을 따옴표로 감싼다. ${SERVER_LOG}("스냅샷 저장소(Cassandra) 오류 → SNAPSHOT_DOWN — …" 에 주소마다의 원인). ${RESTART}`],
  SNAPSHOT_FAILED: ['SNAPSHOT_FAILED', `Cassandra 에는 붙었지만 조회가 실패했다 — CASSANDRA_KEYSPACE(기본 ars)와 계정의 읽기 권한을 본다. ${SERVER_LOG}("스냅샷 저장소(Cassandra) 오류 → SNAPSHOT_FAILED — …"). ${RESTART}`],
  SNAPSHOT_TIMEOUT: ['SNAPSHOT_TIMEOUT', 'Cassandra 응답이 늦다(시간 초과) — 잠시 뒤 다시 돌려 본다. 이어지면 주소·방화벽을 본다'],
  SNAPSHOT_UNSET: ['SNAPSHOT_STALE_SERVER', '떠 있는 서버는 CASSANDRA_CONTACT_POINTS 가 빈 채로 떴다 — .env 를 고친 뒤에는 서버를 다시 띄운다']
}
const HISTORY_FAILURES = {
  HISTORY_DOWN: ['HISTORY_DOWN', `서버가 이력 서버에 연결하지 못했다 — HTTP_WEB_SERVER_URL 의 호스트·포트를 본다. ${SERVER_LOG}. ${RESTART}`],
  HISTORY_TIMEOUT: ['HISTORY_TIMEOUT', '이력 서버 응답이 늦다(시간 초과) — 잠시 뒤 다시 돌려 본다'],
  HISTORY_UNREADABLE: ['HISTORY_UNREADABLE', `이력 서버의 답을 읽지 못했다 — HTTP_WEB_SERVER_URL 이 이력 서버(HttpWebServer)가 아닌 다른 서버의 주소이거나, 이력 서버 쪽에서 오류가 났다. ${SERVER_LOG}. ${RESTART}`],
  HISTORY_UNSET: ['HISTORY_STALE_SERVER', '떠 있는 서버는 HTTP_WEB_SERVER_URL 이 빈 채로 떴다 — .env 를 고친 뒤에는 서버를 다시 띄운다']
}

// 떠 있는 서버를 거쳐 스냅샷·이력을 실제로 한 번씩 조회한다 — 계정·데이터센터 이름·키스페이스는 붙어 봐야 안다.
// 내 범위의 설비 하나로 "가장 늦은 한 장"(한두 줄 읽기)과 이력 한 건(없는 번호면 "없다" 는 답)을 묻는다. 읽기만 한다.
// 서버가 뜬 때의 설정을 본다(.env 파일이 아니다). 서버가 꺼져 있을 때는 부르지 않는다(run — remoteChecks 의 SERVER_DOWN 이 알린다).
// 이력은 Cassandra 설정과 따로다(서버 → 이력 서버) — 스냅샷 조회가 실패해도 묻는다. 이력 주소가 비었거나 꼴이 틀리면 묻지 않는다(checkSnapshotEnv 가 알린다).
async function snapshotRemoteChecks({ api, fetch, env }) {
  if (!cassandraPoints(env).length) return []
  // 답 또는 못 받은 까닭('late' = 시간 초과, 'gone' = 서버에 닿지 않음)
  const ask = async (path) => {
    try { return { res: await fetch(`${api}${path}`, { signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS) }) } } catch (e) { return { why: e && e.name === 'TimeoutError' ? 'late' : 'gone' } }
  }
  const unseen = (code, what, why) => warn(code, `${what} — ${why}. 다시 돌려 본다`)
  const NOT_SEEN = '스냅샷·이력 조회는 보지 않았다'
  const list = await ask('/equipment')
  if (!list.res) return [unseen('SNAPSHOT_NOT_CHECKED', list.why === 'late' ? '설비 목록이 시간 안에 오지 않았다' : '설비 목록을 받다가 서버에 닿지 않게 됐다', NOT_SEEN)]
  if (list.res.status !== 200) return [warn('SNAPSHOT_NOT_CHECKED', `설비 목록 조회가 ${list.res.status} ${await errorCode(list.res)} — ${NOT_SEEN}`)]
  let items
  try { items = (await list.res.json())?.data?.items } catch { return [unseen('SNAPSHOT_NOT_CHECKED', '설비 목록의 답을 읽지 못했다', NOT_SEEN)] }
  // 작은따옴표가 든 설비 ID 는 서버가 이력 서버에 보내지 않는다
  const eqp = (Array.isArray(items) ? items : []).find((e) => e && typeof e.eqpId === 'string' && e.eqpId !== '' && !e.eqpId.includes("'"))
  if (!eqp) return [warn('SNAPSHOT_NOT_CHECKED', `내 범위에 설비가 없다 — ${NOT_SEEN}(스냅샷 패널에도 고를 설비가 없다)`)]

  async function snapshot() {
    const r = await ask(`/snapshots/days?${new URLSearchParams({ eqpId: eqp.eqpId })}`)
    if (!r.res) return r.why === 'late' ? [warn(...SNAPSHOT_FAILURES.SNAPSHOT_TIMEOUT)] : [unseen('SNAPSHOT_NOT_CHECKED', '스냅샷을 묻다가 서버에 닿지 않게 됐다', '스냅샷 조회는 보지 않았다')]
    if (r.res.status === 200) return []
    const code = await errorCode(r.res)
    return [warn(...(SNAPSHOT_FAILURES[code] ?? ['SNAPSHOT_CHECK_FAILED', `스냅샷 조회(${eqp.eqpId})가 ${r.res.status} ${code} — ${SERVER_LOG}`]))]
  }
  async function history() {
    const target = historyUrl(env)
    if (!target || target.problem) return []
    const r = await ask(`/history/${encodeURIComponent(eqp.eqpId)}/${PROBE_TXN}`)
    if (!r.res) return r.why === 'late' ? [warn(...HISTORY_FAILURES.HISTORY_TIMEOUT)] : [unseen('HISTORY_NOT_CHECKED', '이력을 묻다가 서버에 닿지 않게 됐다', '이력 조회는 보지 않았다')]
    if (r.res.status === 200) return []
    const code = await errorCode(r.res)
    if (code === 'HISTORY_NOT_FOUND') return [] // 이력 서버가 "그 번호의 이력이 없다" 고 답했다 — 닿고 읽힌다
    return [warn(...(HISTORY_FAILURES[code] ?? ['HISTORY_CHECK_FAILED', `이력 조회(${eqp.eqpId})가 ${r.res.status} ${code} — ${SERVER_LOG}`]))]
  }
  return (await Promise.all([snapshot(), history()])).flat()
}

function parseArgs(argv) {
  const out = { env: 'server/.env' }
  const keys = { '--env': 'env', '--name': 'name', '--process': 'process', '--model': 'model' }
  for (let i = 0; i < argv.length; i += 1) {
    const key = keys[argv[i]]
    if (!key) throw new Error(`모르는 인자 ${argv[i]} — 쓸 수 있는 것: ${Object.keys(keys).join(' ')}`)
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${argv[i]} 뒤에 값이 없다`)
    out[key] = v
    i += 1
  }
  return out
}

const apiBase = (env) => `http://127.0.0.1:${resolveListenAddress(env).port}/api/scenario-editor`

// server/.env 를 서버와 같은 dotenv 로 읽는다. 없으면 null.
function readEnvFile(path) {
  const full = resolve(ROOT, path)
  if (!existsSync(full)) return null
  const dotenv = createRequire(join(ROOT, 'server/package.json'))('dotenv')
  return dotenv.parse(readFileSync(full))
}

const LABEL = { stop: '멈춤', warn: '경고' }

async function run({ argv, readEnv = readEnvFile, fetch = globalThis.fetch, connect = tcpConnect, log = console.log }) {
  const args = parseArgs(argv)
  const env = readEnv(args.env)
  if (!env) {
    log(`멈춤  ENV_FILE_MISSING  ${args.env} 이 없다 — server\\.env.inhouse.example 을 server\\.env 로 복사해 채운다`)
    return 1
  }
  const api = apiBase(env)
  const findings = [
    ...checkEnv(env), ...(await interfaceCheck({ env, connect })), ...checkName(args),
    ...checkSnapshotEnv(env), ...(await snapshotConnectCheck({ env, connect })),
    ...checkVisionEnv(env), ...(await visionConnectCheck({ env, connect })),
    ...(await remoteChecks({ api, fetch, ...args }))
  ]
  if (!findings.some((f) => f.code === 'SERVER_DOWN')) findings.push(...(await snapshotRemoteChecks({ api, fetch, env })))
  for (const f of findings) log(`${LABEL[f.level]}  ${f.code}  ${f.message}`)
  const stops = findings.filter((f) => f.level === 'stop').length
  const warns = findings.length - stops
  log(stops ? `멈춤 ${stops}·경고 ${warns} — 고친 뒤 다시 돌린다. 멈춤이 있는 채로 시험하지 않는다` : `통과(경고 ${warns})`)
  return stops ? 1 : 0
}

module.exports = { checkEnv, checkName, remoteChecks, interfaceCheck, checkSnapshotEnv, snapshotConnectCheck, snapshotRemoteChecks, checkVisionEnv, visionConnectCheck, parseArgs, apiBase, run }

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then((code) => { process.exitCode = code }, (err) => { console.error(err.message); process.exitCode = 1 })
}
