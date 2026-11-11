'use strict'
// 시험 데이터용 Cassandra 연결. 접속 값은 서버와 같은 이름(`CASSANDRA_*`)이고 `server/.env` 에서 읽는다 — 환경 변수가 있으면 그것이 먼저다.
// 계정·비밀번호는 저장소에 적지 않는다(`server/.env` 는 git 제외).
const fs = require('node:fs')
const path = require('node:path')
const { parseEnv } = require('node:util')

const ENV_FILE = path.join(__dirname, '../../../server/.env')
const PREFIX = 'CASSANDRA_'

function readEnvFile(file = ENV_FILE) {
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
}

// processEnv = 환경 변수, fileText = server/.env 글(없으면 null) → CASSANDRA_ 값만
function cassandraEnv(processEnv, fileText) {
  const out = {}
  const take = (src) => {
    for (const [k, v] of Object.entries(src)) {
      if (k.startsWith(PREFIX) && typeof v === 'string') out[k] = v
    }
  }
  if (typeof fileText === 'string') take(parseEnv(fileText))
  take(processEnv)
  return out
}

const text = (v) => (typeof v === 'string' ? v.trim() : '')

// 시험 데이터 도구는 Cassandra 에 쓴다. `server/.env` 에 사내(운영) 주소가 들어 있어도 쓰지 않도록, 이 PC(루프백)의 Cassandra 가 아니면 멈춘다.
// 문구에는 호스트만 싣는다(계정·비밀번호는 싣지 않는다).
const isLoopback = (h) => {
  const x = String(h).toLowerCase()
  return x === 'localhost' || x === '::1' || /^127(\.\d{1,3}){3}$/.test(x)
}
function assertLocalCassandra(contactPoints) {
  const remote = contactPoints.filter((h) => !isLoopback(h))
  if (remote.length) {
    throw new Error(`시험 데이터 도구는 이 PC(루프백)의 Cassandra 에만 씁니다 — 루프백이 아닌 주소: ${remote.join(', ')} (server/.env 의 CASSANDRA_CONTACT_POINTS)`)
  }
}

// 주소가 비어 있으면 null — 부르는 쪽이 건너뛴다. 루프백이 아닌 주소면 연결하지 않고 던진다.
async function connectCassandra(env = cassandraEnv(process.env, readEnvFile())) {
  const contactPoints = text(env.CASSANDRA_CONTACT_POINTS).split(',').map((s) => s.trim()).filter(Boolean)
  if (!contactPoints.length) return null
  assertLocalCassandra(contactPoints)
  const driver = require('cassandra-driver')
  const options = {
    contactPoints,
    protocolOptions: { port: Number(text(env.CASSANDRA_PORT)) || 9042 },
    localDataCenter: text(env.CASSANDRA_LOCAL_DC) || 'datacenter1',
    keyspace: text(env.CASSANDRA_KEYSPACE) || 'ars',
    socketOptions: { connectTimeout: 5000, readTimeout: 20000 }
  }
  if (text(env.CASSANDRA_USERNAME) && env.CASSANDRA_PASSWORD) {
    options.credentials = { username: text(env.CASSANDRA_USERNAME), password: env.CASSANDRA_PASSWORD }
  }
  const client = new driver.Client(options)
  await client.connect()
  return client
}

module.exports = { cassandraEnv, connectCassandra, readEnvFile, assertLocalCassandra }
