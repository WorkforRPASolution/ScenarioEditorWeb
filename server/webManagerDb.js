'use strict'
// 단독판 전용: WEBMANAGER DB(오류·감사 기록)를 쓸지 정한다. SE_WEBMANAGER_DB=0 이면 EARS 만 연결하고 기록 저장을 끈다 —
// 사내 운영 EARS 에 붙여 읽기 시험을 할 때 운영 Mongo 에 아무것도 쓰지 않기 위해서다. 편입 때 대역과 함께 사라진다.
const { createLogger } = require('./shared/logger')
const { sameDbName } = require('./mongoUri')

const log = createLogger('db')

function webManagerDbEnabled(env) {
  return env.SE_WEBMANAGER_DB !== '0'
}

const DEFAULT_EARS_URI = 'mongodb://localhost:27017/EARS' // connection.js 와 같은 기본값

// connection.js connectDB 의 EARS 부분과 같은 연결. 혼자 붙는 시험이라 연결 수를 적게 잡고, 운영 DB 에서 단독판으로 보이게 이름을 바꾼다.
async function connectEarsOnly(earsConnection, env) {
  await earsConnection.openUri(env.MONGODB_URI || DEFAULT_EARS_URI, {
    autoIndex: false,
    appName: 'ScenarioEditorWeb',
    maxPoolSize: 10,
    minPoolSize: 0
  })
  log.info(`MongoDB EARS Connected: ${earsConnection.host} (WEBMANAGER DB 꺼짐, SE_WEBMANAGER_DB=0)`)
  earsConnection.on('error', (err) => log.error(`MongoDB EARS connection error: ${err.message}`))
  earsConnection.on('disconnected', () => log.warn('MongoDB EARS disconnected'))
}

// SE_WEBMANAGER_DB=0 이어도 초안·배포 기록을 둘 웹 전용 DB 는 따로 연다(SE_WEB_DB_URI). 운영 EARS 가 아닌 DB 이름을 써야 한다.
// WebManagerLog 저장은 꺼진 그대로다. 주소가 없으면 열지 않는다(쓰기 API 는 getWebDb 의 503 으로 막힌다).
// DB 이름이 운영 EARS 와 같으면 열지 않고 던진다 — 초안·배포 기록 컬렉션이 운영 EARS 에 생기지 않게 서버가 뜨지 않는다(P2-E).
async function connectWebDbOnly(webManagerConnection, env) {
  if (webManagerDbEnabled(env) || !env.SE_WEB_DB_URI) return false
  if (sameDbName(env.SE_WEB_DB_URI, env.MONGODB_URI || DEFAULT_EARS_URI)) {
    throw new Error('SE_WEB_DB_URI 의 DB 이름이 운영 EARS(MONGODB_URI)와 같습니다 — 웹 전용 DB 는 다른 이름을 쓰세요')
  }
  await webManagerConnection.openUri(env.SE_WEB_DB_URI, { appName: 'ScenarioEditorWeb', maxPoolSize: 5, autoIndex: false })
  log.info(`MongoDB 웹 전용 DB Connected: ${webManagerConnection.host} (SE_WEB_DB_URI)`)
  webManagerConnection.on('error', (err) => log.error(`MongoDB 웹 전용 DB connection error: ${err.message}`))
  webManagerConnection.on('disconnected', () => log.warn('MongoDB 웹 전용 DB disconnected'))
  return true
}

// verbatim errorHandler 는 오류마다 WebManagerLog 를 저장한다(단독판에서 WEBMANAGER DB 를 쓰는 곳은 이것뿐이다).
// 저장을 아무 일도 하지 않게 한다 — 파일 로그(createErrorLog 의 errorLog.error)는 그대로 남는다.
function disableWebManagerLog({ WebManagerLog }) {
  WebManagerLog.prototype.save = async function save() {
    return this
  }
}

// healthCheck(verbatim)는 두 DB 가 모두 붙어야 mongodb 가 ok 다. WEBMANAGER 를 끈 경우 EARS 만으로 판정한다(전체 판정 규칙은 healthCheck 와 같다).
function healthWithoutWebManager(health) {
  const { ears } = health.components.mongodb
  const redisDown = [health.components.redis_db0, health.components.redis_db10_eqp].some((r) => r.status === 'down')
  const status = ears !== 'ok' ? 'down' : redisDown ? 'degraded' : 'ok'
  return {
    ...health,
    status,
    components: { ...health.components, mongodb: { status: ears, ears, webManager: 'disabled' } }
  }
}

module.exports = { webManagerDbEnabled, connectEarsOnly, connectWebDbOnly, disableWebManagerLog, healthWithoutWebManager }
