import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSnapshotRepository } = require('../repo/snapshotRepository')

// 만든 Client 의 옵션과 execute 호출을 기록하는 가짜 드라이버. pages = execute 가 차례로 돌려줄 쪽(줄 배열), fail = 던질 오류.
function fakeDriver({ pages = [[]], fail = null } = {}) {
  const calls = { clients: [], execute: [], shutdown: 0 }
  class NoHostAvailableError extends Error {}
  class OperationTimedOutError extends Error {}
  class FallthroughRetryPolicy {}
  class Client {
    constructor(options) { calls.clients.push(options); this.page = 0 }
    async execute(query, params, options) {
      calls.execute.push({ query, params, options })
      if (fail) throw fail
      const rows = pages[this.page] ?? []
      this.page++
      return { rows, pageState: this.page < pages.length ? `p${this.page}` : null }
    }
    async shutdown() { calls.shutdown++ }
  }
  const driver = { Client, types: { consistencies: { one: 1 } }, errors: { NoHostAvailableError, OperationTimedOutError }, policies: { retry: { FallthroughRetryPolicy } } }
  return { driver, calls, NoHostAvailableError, OperationTimedOutError, FallthroughRetryPolicy }
}
const ENV = { CASSANDRA_CONTACT_POINTS: '10.0.0.1, 10.0.0.2', CASSANDRA_USERNAME: 'reader', CASSANDRA_PASSWORD: 'pw' }
const names = (...ns) => ns.map((fname) => ({ fname }))
const caught = async (p) => { try { await p } catch (e) { return e } return null }

describe('snapshotRepository — Cassandra 읽기만, 처음 쓸 때 연결 (P3 설계 §5.1)', () => {
  it('configured: 접속 주소가 비거나 공백이면 false', () => {
    const { driver } = fakeDriver()
    expect(createSnapshotRepository({ env: {}, driver }).configured()).toBe(false)
    expect(createSnapshotRepository({ env: { CASSANDRA_CONTACT_POINTS: '  ' }, driver }).configured()).toBe(false)
    expect(createSnapshotRepository({ env: ENV, driver }).configured()).toBe(true)
  })

  it('만들기만 해서는 연결하지 않고, 처음 부를 때 Client 를 한 번 만들어 다시 쓴다', async () => {
    const { driver, calls } = fakeDriver()
    const repo = createSnapshotRepository({ env: ENV, driver })
    expect(calls.clients).toHaveLength(0)
    await repo.latestName('E1', { year: 2026, month: 11 })
    await repo.latestName('E1', { year: 2026, month: 10 })
    expect(calls.clients).toHaveLength(1)
  })

  it('Client 옵션: 주소·포트·데이터센터·키스페이스 기본값, 계정, 읽기 한도 10초, 다시 보내지 않음', async () => {
    const { driver, calls, FallthroughRetryPolicy } = fakeDriver()
    await createSnapshotRepository({ env: ENV, driver }).latestName('E1', { year: 2026, month: 11 })
    const o = calls.clients[0]
    expect(o.contactPoints).toEqual(['10.0.0.1', '10.0.0.2'])
    expect(o.protocolOptions).toEqual({ port: 9042 })
    expect(o.localDataCenter).toBe('datacenter1')
    expect(o.keyspace).toBe('ars')
    expect(o.credentials).toEqual({ username: 'reader', password: 'pw' })
    expect(o.socketOptions.readTimeout).toBe(10000)
    expect(o.queryOptions.consistency).toBe(1)
    expect(o.policies.retry).toBeInstanceOf(FallthroughRetryPolicy)
  })

  it('Client 옵션: 설정값을 따르고, 계정은 둘 다 있을 때만 넣는다', async () => {
    const { driver, calls } = fakeDriver()
    const env = { CASSANDRA_CONTACT_POINTS: 'h', CASSANDRA_PORT: '19042', CASSANDRA_LOCAL_DC: 'dc9', CASSANDRA_KEYSPACE: 'ars2', CASSANDRA_USERNAME: 'reader' }
    await createSnapshotRepository({ env, driver }).latestName('E1', { year: 2026, month: 11 })
    const o = calls.clients[0]
    expect(o.protocolOptions).toEqual({ port: 19042 })
    expect(o.localDataCenter).toBe('dc9')
    expect(o.keyspace).toBe('ars2')
    expect('credentials' in o).toBe(false)
  })

  it('listNames: 이름 범위 CQL·바인드 변수·prepare·쪽 크기, 쪽을 이어 읽는다', async () => {
    const { driver, calls } = fakeDriver({ pages: [names('a', 'b'), names('c')] })
    const out = await createSnapshotRepository({ env: ENV, driver }).listNames('E1', { year: 2026, month: 11 }, '1000000000000', '1000000086400', 10)
    expect(out).toEqual({ names: ['a', 'b', 'c'], truncated: false })
    expect(calls.execute[0].query).toBe('select fname from snapshotlist where eqpid = ? and year = ? and month = ? and fname >= ? and fname < ?')
    expect(calls.execute[0].params).toEqual(['E1', 2026, 11, '1000000000000', '1000000086400'])
    expect(calls.execute[0].options).toMatchObject({ prepare: true, fetchSize: 5000 })
    expect(calls.execute[0].options.pageState).toBeUndefined()
    expect(calls.execute[1].options.pageState).toBe('p1')
  })

  it('listNames: 한도에서 멈춘다 — 한도를 넘긴 쪽까지만 읽고 truncated', async () => {
    const { driver, calls } = fakeDriver({ pages: [names('a', 'b', 'c'), names('d', 'e', 'f'), names('g', 'h', 'i'), names('j')] })
    const out = await createSnapshotRepository({ env: ENV, driver }).listNames('E1', { year: 2026, month: 11 }, '0', '9', 5)
    expect(out).toEqual({ names: ['a', 'b', 'c', 'd', 'e'], truncated: true })
    expect(calls.execute).toHaveLength(2) // 셋째·넷째 쪽은 읽지 않는다
  })

  it('listNames: 꼭 한도만큼이면 truncated 가 아니다', async () => {
    const { driver } = fakeDriver({ pages: [names('a', 'b')] })
    const out = await createSnapshotRepository({ env: ENV, driver }).listNames('E1', { year: 2026, month: 11 }, '0', '9', 2)
    expect(out).toEqual({ names: ['a', 'b'], truncated: false })
  })

  it('latestName: 내림차순 한 줄, 없으면 null', async () => {
    const a = fakeDriver({ pages: [names('z')] })
    expect(await createSnapshotRepository({ env: ENV, driver: a.driver }).latestName('E1', { year: 2026, month: 11 })).toBe('z')
    expect(a.calls.execute[0].query).toBe('select fname from snapshotlist where eqpid = ? and year = ? and month = ? order by fname desc limit 1')
    expect(a.calls.execute[0].params).toEqual(['E1', 2026, 11])
    expect(a.calls.execute[0].options).toMatchObject({ prepare: true })
    const b = fakeDriver({ pages: [[]] })
    expect(await createSnapshotRepository({ env: ENV, driver: b.driver }).latestName('E1', { year: 2026, month: 11 })).toBeNull()
  })

  it('imageBase64: 키 한 줄, 없으면 null', async () => {
    const a = fakeDriver({ pages: [[{ image: 'QUJD' }]] })
    expect(await createSnapshotRepository({ env: ENV, driver: a.driver }).imageBase64('E1', { year: 2026, month: 11, day: 11 }, 'f.png')).toBe('QUJD')
    expect(a.calls.execute[0].query).toBe('select image from snapshot where eqpid = ? and year = ? and month = ? and day = ? and fname = ?')
    expect(a.calls.execute[0].params).toEqual(['E1', 2026, 11, 11, 'f.png'])
    expect(a.calls.execute[0].options).toMatchObject({ prepare: true })
    const b = fakeDriver({ pages: [[]] })
    expect(await createSnapshotRepository({ env: ENV, driver: b.driver }).imageBase64('E1', { year: 2026, month: 11, day: 11 }, 'f.png')).toBeNull()
  })

  it('미설정이면 503 SNAPSHOT_UNSET 이고 Client 를 만들지 않는다', async () => {
    const { driver, calls } = fakeDriver()
    const e = await caught(createSnapshotRepository({ env: {}, driver }).latestName('E1', { year: 2026, month: 11 }))
    expect([e.statusCode, e.code]).toEqual([503, 'SNAPSHOT_UNSET'])
    expect(calls.clients).toHaveLength(0)
  })

  it('오류 바꾸기: 연결 못 함 503 SNAPSHOT_DOWN · 시간 초과 504 SNAPSHOT_TIMEOUT · 그 밖 502 SNAPSHOT_FAILED — 주소·계정을 문구에 싣지 않는다', async () => {
    const table = [
      ['NoHostAvailableError', 503, 'SNAPSHOT_DOWN'],
      ['OperationTimedOutError', 504, 'SNAPSHOT_TIMEOUT'],
      ['Error', 502, 'SNAPSHOT_FAILED']
    ]
    for (const [kind, status, code] of table) {
      const f = fakeDriver()
      const Err = kind === 'Error' ? Error : f[kind]
      const repo = createSnapshotRepository({ env: ENV, driver: { ...f.driver, Client: class { async execute() { throw new Err('10.0.0.1:9042 reader pw 실패') } async shutdown() {} } } })
      const e = await caught(repo.listNames('E1', { year: 2026, month: 11 }, '0', '9', 5))
      expect([e.statusCode, e.code], kind).toEqual([status, code])
      expect(e.message).not.toMatch(/10\.0\.0\.1|reader|pw/)
    }
  })

  it('연결을 못 한 Client 는 버리고 다음 호출 때 새로 만든다', async () => {
    const f = fakeDriver()
    let made = 0
    let down = true
    const Client = class {
      constructor() { made++ }
      async execute() { if (down) throw new f.NoHostAvailableError('x'); return { rows: [], pageState: null } }
      async shutdown() {}
    }
    const repo = createSnapshotRepository({ env: ENV, driver: { ...f.driver, Client } })
    expect((await caught(repo.latestName('E1', { year: 2026, month: 11 }))).code).toBe('SNAPSHOT_DOWN')
    down = false
    expect(await repo.latestName('E1', { year: 2026, month: 11 })).toBeNull()
    expect(made).toBe(2)
  })

  it('shutdown: 만든 Client 가 있으면 닫고, 없으면 아무 일 없다', async () => {
    const { driver, calls } = fakeDriver()
    const repo = createSnapshotRepository({ env: ENV, driver })
    await repo.shutdown()
    expect(calls.shutdown).toBe(0)
    await repo.latestName('E1', { year: 2026, month: 11 })
    await repo.shutdown()
    expect(calls.shutdown).toBe(1)
  })
})
