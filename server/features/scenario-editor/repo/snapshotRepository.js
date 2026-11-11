'use strict'
// 스냅샷 저장소 — Cassandra `ars.snapshotlist`(목록)·`ars.snapshot`(그림)을 읽기만 한다(P3 설계 §5.1, 40 §2.0 2026-11-11).
// - 웹은 Cassandra 에 쓰지 않는다. CQL 은 아래 셋뿐이고 값은 모두 바인드 변수다.
// - 연결은 처음 쓸 때 맺는다 — Cassandra 가 없거나 설정이 비어도 서버와 다른 API 는 그대로 돈다.
// - 목록은 쪽(fetchSize)으로 읽다가 한도에서 멈춘다. 한 달치를 한꺼번에 받지 않는다.
const { seError } = require('../errors')

const READ_TIMEOUT_MS = 10000
const CONNECT_TIMEOUT_MS = 5000
const FETCH_SIZE = 5000
const Q_LIST = 'select fname from snapshotlist where eqpid = ? and year = ? and month = ? and fname >= ? and fname < ?'
const Q_LATEST = 'select fname from snapshotlist where eqpid = ? and year = ? and month = ? and fname >= ? order by fname desc limit 1'
const Q_IMAGE = 'select image from snapshot where eqpid = ? and year = ? and month = ? and day = ? and fname = ?'

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const port = (v) => (/^\d+$/.test(text(v)) ? Number(text(v)) : 9042)

function createSnapshotRepository({ env = process.env, driver }) {
  let client = null
  const points = () => text(env.CASSANDRA_CONTACT_POINTS).split(',').map((s) => s.trim()).filter(Boolean)
  const configured = () => points().length > 0

  function options() {
    const o = {
      contactPoints: points(),
      protocolOptions: { port: port(env.CASSANDRA_PORT) },
      localDataCenter: text(env.CASSANDRA_LOCAL_DC) || 'datacenter1',
      keyspace: text(env.CASSANDRA_KEYSPACE) || 'ars',
      socketOptions: { readTimeout: READ_TIMEOUT_MS, connectTimeout: CONNECT_TIMEOUT_MS },
      queryOptions: { consistency: driver.types.consistencies.one },
      policies: { retry: new driver.policies.retry.FallthroughRetryPolicy() } // 다시 보내지 않는다
    }
    const username = text(env.CASSANDRA_USERNAME)
    const password = typeof env.CASSANDRA_PASSWORD === 'string' ? env.CASSANDRA_PASSWORD : ''
    if (username && password) o.credentials = { username, password }
    return o
  }

  // 드라이버 오류 → API 오류. 드라이버 문구에는 주소·계정이 들어 있을 수 있어 싣지 않는다.
  function mapped(e) {
    if (e && typeof e.code === 'string' && e.statusCode) return e
    if (e instanceof driver.errors.NoHostAvailableError) return seError(503, 'SNAPSHOT_DOWN', '스냅샷 저장소(Cassandra)에 연결하지 못했습니다')
    if (e instanceof driver.errors.OperationTimedOutError) return seError(504, 'SNAPSHOT_TIMEOUT', '스냅샷 저장소(Cassandra) 응답이 늦습니다')
    return seError(502, 'SNAPSHOT_FAILED', '스냅샷 저장소(Cassandra) 조회가 실패했습니다')
  }

  async function run(query, params, extra) {
    if (!configured()) throw seError(503, 'SNAPSHOT_UNSET', '스냅샷 저장소(Cassandra) 주소가 설정되지 않았습니다')
    if (!client) client = new driver.Client(options())
    const used = client
    try {
      return await used.execute(query, params, { prepare: true, ...extra })
    } catch (e) {
      // 연결을 못 한 Client 는 다시 쓰지 않는다 — 다음 호출이 새로 만든다.
      if (e instanceof driver.errors.NoHostAvailableError && client === used) {
        client = null
        used.shutdown().catch(() => {})
      }
      throw mapped(e)
    }
  }

  async function listNames(eqpId, { year, month }, fromName, toName, limit) {
    const names = []
    let pageState
    do {
      const r = await run(Q_LIST, [eqpId, year, month, fromName, toName], { fetchSize: FETCH_SIZE, ...(pageState ? { pageState } : {}) })
      for (const row of r.rows) names.push(row.fname)
      pageState = r.pageState || null
    } while (pageState && names.length <= limit)
    const truncated = names.length > limit
    return { names: truncated ? names.slice(0, limit) : names, truncated }
  }

  // fromName = 이름 하한. 보관 기간이 지나 지워진 줄만 남은 달을 끝에서부터 훑으면 Cassandra 가 조회를 실패시킨다
  // (tombstone_failure_threshold 10만 — 큰 달 측정 2026-11-12). 하한을 주면 그 줄들을 지나가지 않는다.
  async function latestName(eqpId, { year, month }, fromName) {
    const r = await run(Q_LATEST, [eqpId, year, month, fromName])
    return r.rows.length ? r.rows[0].fname : null
  }

  async function imageBase64(eqpId, { year, month, day }, fileName) {
    const r = await run(Q_IMAGE, [eqpId, year, month, day, fileName])
    return r.rows.length ? r.rows[0].image : null
  }

  async function shutdown() {
    if (!client) return
    const used = client
    client = null
    await used.shutdown()
  }

  return { configured, listNames, latestName, imageBase64, shutdown }
}

module.exports = { createSnapshotRepository }
