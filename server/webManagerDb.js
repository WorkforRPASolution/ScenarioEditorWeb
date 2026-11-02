'use strict'
// 단독판 전용: WEBMANAGER DB(오류·감사 기록)를 쓸지 정한다. SE_WEBMANAGER_DB=0 이면 EARS 만 연결하고 기록 저장을 끈다 —
// 사내 운영 EARS 에 붙여 읽기 시험을 할 때 운영 Mongo 에 아무것도 쓰지 않기 위해서다. 편입 때 대역과 함께 사라진다.
const { createLogger } = require('./shared/logger')

const log = createLogger('db')

function webManagerDbEnabled(env) {
  return env.SE_WEBMANAGER_DB !== '0'
}

// connection.js connectDB 의 EARS 부분과 같은 연결. 혼자 붙는 시험이라 연결 수를 적게 잡고, 운영 DB 에서 단독판으로 보이게 이름을 바꾼다.
async function connectEarsOnly(earsConnection, env) {
  await earsConnection.openUri(env.MONGODB_URI || 'mongodb://localhost:27017/EARS', {
    autoIndex: false,
    appName: 'ScenarioEditorWeb',
    maxPoolSize: 10,
    minPoolSize: 0
  })
  log.info(`MongoDB EARS Connected: ${earsConnection.host} (WEBMANAGER DB 꺼짐, SE_WEBMANAGER_DB=0)`)
  earsConnection.on('error', (err) => log.error(`MongoDB EARS connection error: ${err.message}`))
  earsConnection.on('disconnected', () => log.warn('MongoDB EARS disconnected'))
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

module.exports = { webManagerDbEnabled, connectEarsOnly, disableWebManagerLog, healthWithoutWebManager }
