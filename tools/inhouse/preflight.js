'use strict'
// 사내 쓰기 시험(P2-E) 사전 점검 — 단독판을 사내 운영 EARS 에 붙여 저장·배포하기 전에 server/.env 를 본다(설계 §12, README "사내 쓰기 시험").
// 쓰기: node tools/inhouse/preflight.js [--env server/.env] [--name SEW_TEST_yyyyMMdd --process <공정> --model <모델>]
// 멈춤이 하나라도 있으면 종료 코드 1. 서버가 떠 있으면 쓰기 권한(/me)을, --name 을 주면 이름 규칙(/name-rule)과 그 이름이 이미 있는지(/scenarios)도 본다.
// tools 의 패키지를 쓰지 않는다 — 사내 PC 는 tools 를 설치하지 않으므로 Node 내장과 server 의 dotenv·순수 모듈만 부른다.
const { readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { createRequire } = require('node:module')
const { isLoopbackHost, resolveListenAddress } = require('../../server/listen')
const { mongoDbName, sameDbName } = require('../../server/mongoUri')

const ROOT = join(__dirname, '../..')
const DEFAULT_EARS_URI = 'mongodb://localhost:27017/EARS' // 서버 연결 코드의 기본값
const DEFAULT_IMAGE_CACHE_DIRS = new Set(['', './.cache/images', '.cache/images'])
const TEST_NAME = /^SEW_TEST_\d{8}(_\d+)?$/

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
    out.push(stop('WEB_DB_MISSING', 'SE_WEB_DB_URI 가 비었다 — 초안·배포 기록을 둘 웹 전용 DB 가 없어 저장·배포가 503 이다. 운영 EARS 가 아닌 DB 이름으로 채운다(예: …/SE_WEB_TEST)'))
  } else if (mongoDbName(env.SE_WEB_DB_URI) === '') {
    out.push(stop('WEB_DB_NAME_MISSING', 'SE_WEB_DB_URI 에 DB 이름이 없다 — 드라이버가 test DB 에 쓴다. 주소 끝에 /SE_WEB_TEST 처럼 DB 이름을 넣는다'))
  } else if (sameDbName(env.SE_WEB_DB_URI, env.MONGODB_URI || DEFAULT_EARS_URI)) {
    out.push(stop('WEB_DB_SAME_AS_EARS', `SE_WEB_DB_URI 의 DB 이름(${mongoDbName(env.SE_WEB_DB_URI)})이 운영 EARS(MONGODB_URI)와 같다 — 초안·배포 기록이 운영 EARS 에 생긴다. 다른 DB 이름을 쓴다(서버도 이대로는 뜨지 않는다)`))
  }
  if (blank(env.EARS_INTERFACE_URL)) out.push(stop('INTERFACE_URL_MISSING', 'EARS_INTERFACE_URL 이 비었다 — 배포할 곳이 없다. 사내 InterfaceServer 주소를 넣는다'))
  if (blank(env.SE_USER_SINGLEID)) out.push(stop('USER_MISSING', 'SE_USER_SINGLEID 가 비었다 — 본인 SingleID(WRITE 권한)를 넣는다'))
  if (env.SE_DEV_USER_OVERRIDE === '1') out.push(stop('DEV_USER_OVERRIDE_ON', 'SE_DEV_USER_OVERRIDE=1 — 브라우저에서 다른 사용자로 바꿔 저장할 수 있다. 0 으로 둔다'))
  if (DEFAULT_IMAGE_CACHE_DIRS.has(String(env.IMAGE_CACHE_DIR ?? '').trim())) {
    out.push(warn('IMAGE_CACHE_DEFAULT', 'IMAGE_CACHE_DIR 이 기본값(server\\.cache\\images) — 운영 시나리오의 기준 화면이 저장소 폴더 안에 쌓인다(상한 IMAGE_CACHE_MAX_MB). 디스크 여유를 보고, 다른 곳에 두려면 경로를 넣는다'))
  }
  return out
}

// 시험 시나리오 이름. 다른 시나리오에 쓰지 않게 SEW_TEST_yyyyMMdd(_n) 만 받는다(계획 Global Constraints).
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
  const down = () => (named ? stop : warn)('SERVER_DOWN', `${api} 에 닿지 않는다 — 쓰기 권한과 시험 이름은 보지 않았다. 서버(npm run dev)를 띄운 창은 두고 새 명령 프롬프트 창에서 다시 돌린다`)
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
  else if (hasNameRule((await rule.json())?.data)) out.push(warn('NAME_RULE', `이름 규칙이 있다 — 새 시나리오 창에서 ${name} 을 칠 수 없다. README 5단계 "이름 규칙이 있을 때" 대로 저장 창에서 이름을 바꾼다`))
  const list = await get(`/scenarios?${new URLSearchParams({ process, model })}`)
  if (!list) return [...out, down()]
  if (list.status !== 200) return [...out, stop('LIST_FAILED', `${process}·${model} 목록 조회가 ${list.status} ${await errorCode(list)} — 공정·모델 이름과 권한을 본다`)]
  const rows = (await list.json())?.data ?? []
  if (rows.some((r) => r.name === name)) {
    out.push(stop('NAME_EXISTS', `${process}·${model} 에 ${name} 이 이미 있다 — 덮어쓰지 않는다. 다른 접미사를 쓴다(예: ${nextName(name)})`))
  }
  return out
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

async function run({ argv, readEnv = readEnvFile, fetch = globalThis.fetch, log = console.log }) {
  const args = parseArgs(argv)
  const env = readEnv(args.env)
  if (!env) {
    log(`멈춤  ENV_FILE_MISSING  ${args.env} 이 없다 — server\\.env.inhouse.example 을 server\\.env 로 복사해 채운다`)
    return 1
  }
  const findings = [...checkEnv(env), ...checkName(args), ...(await remoteChecks({ api: apiBase(env), fetch, ...args }))]
  for (const f of findings) log(`${LABEL[f.level]}  ${f.code}  ${f.message}`)
  const stops = findings.filter((f) => f.level === 'stop').length
  const warns = findings.length - stops
  log(stops ? `멈춤 ${stops}·경고 ${warns} — 고친 뒤 다시 돌린다. 멈춤이 있는 채로 시험하지 않는다` : `통과(경고 ${warns})`)
  return stops ? 1 : 0
}

module.exports = { checkEnv, checkName, remoteChecks, parseArgs, apiBase, run }

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then((code) => { process.exitCode = code }, (err) => { console.error(err.message); process.exitCode = 1 })
}
