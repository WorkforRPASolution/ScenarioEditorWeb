import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const { planSnapshots, seedSnapshots, cleanSnapshots, removeSnapshots, partitionOf } = require('../lib/snapshots')
const { cassandraEnv, connectCassandra, assertLocalCassandra } = require('../lib/cassandra')
const { planBig, seedBig, BIG_EQP, IDLE_EQP } = require('../lib/snapshotsBig')
const { PHOTO, CVD } = require('../data/snapshots')
const { equipment } = require('../data/equipment')
// 시험만 서버를 읽는다 — 넣는 이름이 서버가 받는 꼴인지 본다.
const { parseSnapshotName } = require('../../../server/features/scenario-editor/domain/snapshotName')

const DAY = 86400000
const kst = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms)
const NOW = kst(2026, 11, 11, 9, 0, 0) // 2026-11-11 09:00 KST
const within = (ms, y, mo, d) => ms >= kst(y, mo, d) && ms < kst(y, mo, d) + DAY

function fakeClient() {
  const calls = []
  return { calls, execute: async (query, params, options) => { calls.push({ query, params, options }); return { rows: [] } } }
}

describe('planSnapshots — 넣을 스냅샷 (순수 함수)', () => {
  const rows = planSnapshots(NOW)
  const parsed = rows.map((r) => ({ ...r, p: parseSnapshotName(r.fileName) }))
  const photo = parsed.filter((r) => r.eqpId === PHOTO)
  const today = photo.filter((r) => within(r.ms, 2026, 11, 11))

  it('설비는 시험 설비 둘뿐이고 설비 목록에 있다', () => {
    expect([...new Set(rows.map((r) => r.eqpId))].sort()).toEqual([CVD, PHOTO].sort())
    for (const id of [PHOTO, CVD]) {
      expect(id.startsWith('SEWT_')).toBe(true)
      expect(equipment.some((e) => e.eqpId === id)).toBe(true)
    }
  })

  it('모든 이름이 서버가 받는 꼴이고 ms 가 이름과 같다', () => {
    for (const r of parsed) {
      expect(r.p, r.fileName).not.toBeNull()
      expect(r.p.ms).toBe(r.ms)
    }
    expect(new Set(rows.map((r) => `${r.eqpId}/${r.fileName}`)).size).toBe(rows.length)
  })

  it('오늘: 클릭 12장(ms 가 모두 다름) + 같은 ms 의 클릭 한 장 + 목록에만 있는 한 장', () => {
    const clicks = today.filter((r) => r.p.kind === 'click')
    expect(clicks).toHaveLength(14)
    expect(clicks.filter((r) => r.png === null)).toHaveLength(1)
    expect(new Set(clicks.map((r) => r.ms)).size).toBe(14)
    for (const r of clicks) {
      expect(r.p.x).toBeLessThan(640)
      expect(r.p.y).toBeLessThan(360)
    }
  })

  it('오늘: 태그 다섯 종이 같은 txn 으로 한 벌, 이력 대상이다', () => {
    const tags = today.filter((r) => r.p.kind === 'tag')
    const run = tags.filter((r) => r.p.txn === tags.find((t) => t.p.tag === 'success').p.txn)
    expect(run.map((r) => r.p.tag).sort()).toEqual(['fail', 'skip', 'start', 'stop', 'success'])
    expect(run.every((r) => r.p.hasHistory)).toBe(true)
  })

  it('오늘: 같은 ms 에 클릭과 태그가 한 장씩 있다', () => {
    const byMs = new Map()
    for (const r of today) byMs.set(r.ms, [...(byMs.get(r.ms) || []), r.p.kind])
    const pairs = [...byMs.values()].filter((kinds) => kinds.length > 1)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].sort()).toEqual(['click', 'tag'])
  })

  it('어제 클릭 3장, 14일 반 전 클릭 1장(1일 뒤 삭제)', () => {
    expect(photo.filter((r) => within(r.ms, 2026, 11, 10)).map((r) => r.p.kind)).toEqual(['click', 'click', 'click'])
    const old = photo.filter((r) => r.ms < kst(2026, 11, 10))
    expect(old).toHaveLength(1)
    expect(old[0].ms).toBe(NOW - 14.5 * DAY)
    expect(old[0].p.kind).toBe('click')
  })

  it('다른 공정 설비에 오늘 2장', () => {
    const cvd = parsed.filter((r) => r.eqpId === CVD)
    expect(cvd).toHaveLength(2)
    expect(cvd.every((r) => within(r.ms, 2026, 11, 11))).toBe(true)
  })

  it('그림은 640×360 PNG 이고 장마다 다르다', () => {
    const withPng = rows.filter((r) => r.png)
    expect(withPng).toHaveLength(rows.length - 1)
    for (const r of withPng) {
      expect(r.png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    }
    const first = PNG.sync.read(withPng[0].png)
    expect([first.width, first.height]).toEqual([640, 360])
    expect(new Set(withPng.map((r) => r.png.toString('base64'))).size).toBe(withPng.length)
  })

  it('"오늘" 은 KST 날짜다 — 자정 직후에 돌려도 그 날에 넣는다', () => {
    const late = planSnapshots(kst(2026, 12, 1, 0, 5, 0)).filter((r) => r.eqpId === CVD)
    expect(late.every((r) => within(r.ms, 2026, 12, 1))).toBe(true)
  })
})

describe('partitionOf — 스냅샷 서버와 같은 파티션(KST)', () => {
  it('KST 0시에 날이 바뀐다', () => {
    expect(partitionOf(Date.UTC(2026, 10, 10, 15, 0, 0))).toEqual({ year: 2026, month: 11, day: 11 })
    expect(partitionOf(Date.UTC(2026, 10, 10, 14, 59, 59, 999))).toEqual({ year: 2026, month: 11, day: 10 })
    expect(partitionOf(kst(2027, 1, 1, 0, 0, 0))).toEqual({ year: 2027, month: 1, day: 1 })
  })
})

describe('seedSnapshots — 넣기', () => {
  it('목록 줄과 그림 줄을 스냅샷 서버와 같은 꼴로 넣는다 — TTL 을 주지 않는다', async () => {
    const client = fakeClient()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const ms = kst(2026, 11, 11, 9, 13, 2, 4)
    const out = await seedSnapshots(client, [{ eqpId: PHOTO, fileName: `${ms}_[1][2].png`, ms, png }])
    expect(out).toEqual({ list: 1, image: 1 })
    expect(client.calls).toEqual([
      { query: 'insert into snapshotlist (eqpid, year, month, fname, fname_data) values (?, ?, ?, ?, ?)', params: [PHOTO, 2026, 11, `${ms}_[1][2].png`, `${ms}_[1][2].png`], options: { prepare: true } },
      { query: 'insert into snapshot (eqpid, year, month, day, fname, image) values (?, ?, ?, ?, ?, ?)', params: [PHOTO, 2026, 11, 11, `${ms}_[1][2].png`, png.toString('base64')], options: { prepare: true } }
    ])
    expect(client.calls.some((c) => /ttl/i.test(c.query))).toBe(false)
  })

  it('png 가 null 이면 목록 줄만 넣는다', async () => {
    const client = fakeClient()
    const ms = kst(2026, 11, 11, 16)
    expect(await seedSnapshots(client, [{ eqpId: PHOTO, fileName: `${ms}_[1][2].png`, ms, png: null }])).toEqual({ list: 1, image: 0 })
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].query).toMatch(/^insert into snapshotlist /)
  })

  it('시험 설비가 아니면 아무것도 넣지 않고 던진다', async () => {
    const client = fakeClient()
    const rows = [{ eqpId: PHOTO, fileName: '1_[1][2].png', ms: 1, png: null }, { eqpId: 'EQP_REAL_01', fileName: '1_[1][2].png', ms: 1, png: null }]
    await expect(seedSnapshots(client, rows)).rejects.toThrow(/SEWT_/)
    expect(client.calls).toHaveLength(0)
  })
})

describe('cleanSnapshots — 지우기', () => {
  it('준 설비의 최근 27일~내일 파티션만 지운다', async () => {
    const client = fakeClient()
    const out = await cleanSnapshots(client, [PHOTO, CVD], NOW)
    const list = client.calls.filter((c) => c.query === 'delete from snapshotlist where eqpid = ? and year = ? and month = ?')
    const image = client.calls.filter((c) => c.query === 'delete from snapshot where eqpid = ? and year = ? and month = ? and day = ?')
    expect(list.length + image.length).toBe(client.calls.length)
    expect(client.calls.every((c) => c.options.prepare === true)).toBe(true)
    // 2026-10-15 ~ 2026-11-12 (KST): 달 둘, 날 29
    expect(list.map((c) => c.params)).toEqual([[PHOTO, 2026, 10], [PHOTO, 2026, 11], [CVD, 2026, 10], [CVD, 2026, 11]])
    const photoDays = image.filter((c) => c.params[0] === PHOTO).map((c) => c.params.slice(1))
    expect(photoDays).toHaveLength(29)
    expect(photoDays[0]).toEqual([2026, 10, 15])
    expect(photoDays[28]).toEqual([2026, 11, 12])
    expect(out).toEqual({ listPartitions: 4, imagePartitions: 58 })
  })

  it('시험 설비가 아닌 것이 섞이면 아무것도 지우지 않고 던진다', async () => {
    const client = fakeClient()
    await expect(cleanSnapshots(client, [PHOTO, 'EQP_REAL_01'], NOW)).rejects.toThrow(/SEWT_/)
    await expect(cleanSnapshots(client, [''], NOW)).rejects.toThrow(/SEWT_/)
    expect(client.calls).toHaveLength(0)
  })
})

describe('removeSnapshots — 넣은 줄만 지우기 (통합 시험 정리용)', () => {
  it('줄마다 목록·그림을 키로 지운다', async () => {
    const client = fakeClient()
    const ms = kst(2026, 10, 31, 23, 30)
    const name = `${ms}_[1][2].png`
    expect(await removeSnapshots(client, [{ eqpId: PHOTO, fileName: name, ms, png: null }])).toEqual({ rows: 1 })
    expect(client.calls).toEqual([
      { query: 'delete from snapshotlist where eqpid = ? and year = ? and month = ? and fname = ?', params: [PHOTO, 2026, 10, name], options: { prepare: true } },
      { query: 'delete from snapshot where eqpid = ? and year = ? and month = ? and day = ? and fname = ?', params: [PHOTO, 2026, 10, 31, name], options: { prepare: true } }
    ])
  })

  it('시험 설비가 아니면 아무것도 지우지 않고 던진다', async () => {
    const client = fakeClient()
    await expect(removeSnapshots(client, [{ eqpId: 'EQP_REAL_01', fileName: '1_[1][2].png', ms: 1, png: null }])).rejects.toThrow(/SEWT_/)
    expect(client.calls).toHaveLength(0)
  })
})

describe('planBig — 큰 달 측정용 (목록 줄만)', () => {
  const plan = planBig(NOW, { bigCount: 1000, idleCount: 400 })

  it('바쁜 설비: 이번 달(KST) 1일부터 지금까지 고르게, 앞 절반은 지워질 줄', () => {
    const big = plan.filter((r) => r.eqpId === BIG_EQP)
    expect(big).toHaveLength(1000)
    expect(big.every((r) => r.ms >= kst(2026, 11, 1) && r.ms < NOW)).toBe(true)
    expect(new Set(big.map((r) => r.fileName)).size).toBe(1000)
    expect(big.map((r) => r.ms)).toEqual([...big.map((r) => r.ms)].sort((a, b) => a - b))
    expect(big.slice(0, 500).every((r) => r.expired)).toBe(true)
    expect(big.slice(500).every((r) => !r.expired)).toBe(true)
    expect(big.every((r) => parseSnapshotName(r.fileName).ms === r.ms)).toBe(true)
  })

  it('오래 쉰 설비: 16일 전까지의 열흘에 모두 지워질 줄 — 보관 기간 밖이다', () => {
    const idle = plan.filter((r) => r.eqpId === IDLE_EQP)
    expect(idle).toHaveLength(400)
    expect(idle.every((r) => r.expired)).toBe(true)
    expect(idle.every((r) => r.ms >= NOW - 26 * DAY && r.ms < NOW - 16 * DAY)).toBe(true)
  })

  it('두 설비 모두 시험 설비이고 seed·통합 시험의 스냅샷 설비와 겹치지 않는다', () => {
    for (const id of [BIG_EQP, IDLE_EQP]) {
      expect(equipment.some((e) => e.eqpId === id), id).toBe(true)
      expect([PHOTO, CVD, 'SEWT_ETCH_A01', 'SEWT_ETCH_B01']).not.toContain(id)
    }
  })

  it('월초라 이번 달이 줄 수보다 짧으면 던진다', () => {
    expect(() => planBig(kst(2026, 11, 1, 0, 0, 0, 500), { bigCount: 1000, idleCount: 1 })).toThrow(/월초/)
  })
})

describe('seedBig — 묶어서 넣기', () => {
  it('지워질 줄은 TTL 1 로, 나머지는 TTL 없이 — 한 묶음은 한 파티션의 같은 종류 줄이다', async () => {
    const batches = []
    const client = { batch: async (queries, options) => { batches.push({ queries, options }) } }
    const rows = planBig(NOW, { bigCount: 100, idleCount: 30 })
    const out = await seedBig(client, rows, { batchSize: 40, concurrency: 2 })
    expect(out).toEqual({ rows: 130, expired: 80, batches: batches.length })
    const all = batches.flatMap((b) => b.queries)
    expect(all).toHaveLength(130)
    expect(all.filter((q) => q.query === 'insert into snapshotlist (eqpid, year, month, fname, fname_data) values (?, ?, ?, ?, ?) using ttl 1')).toHaveLength(80)
    expect(all.filter((q) => q.query === 'insert into snapshotlist (eqpid, year, month, fname, fname_data) values (?, ?, ?, ?, ?)')).toHaveLength(50)
    for (const b of batches) {
      expect(b.queries.length).toBeLessThanOrEqual(40)
      expect(b.options).toMatchObject({ prepare: true, logged: false })
      expect(new Set(b.queries.map((q) => `${q.query}|${q.params.slice(0, 3).join('/')}`)).size).toBe(1)
    }
  })

  it('시험 설비가 아니면 넣지 않고 던진다', async () => {
    const client = { batch: async () => { throw new Error('불리면 안 된다') } }
    await expect(seedBig(client, [{ eqpId: 'EQP_REAL_01', fileName: '1_[1][2].png', ms: 1, expired: false }])).rejects.toThrow(/SEWT_/)
  })
})

describe('cassandraEnv — 접속 값 (server/.env, 환경 변수가 먼저)', () => {
  it('server/.env 글에서 CASSANDRA_ 값만 읽는다', () => {
    const text = 'MONGODB_URI=mongodb://x\nCASSANDRA_CONTACT_POINTS=127.0.0.1\n# 주석\nCASSANDRA_PORT=9042\nCASSANDRA_USERNAME=u\nCASSANDRA_PASSWORD="p w"\n'
    expect(cassandraEnv({}, text)).toEqual({ CASSANDRA_CONTACT_POINTS: '127.0.0.1', CASSANDRA_PORT: '9042', CASSANDRA_USERNAME: 'u', CASSANDRA_PASSWORD: 'p w' })
  })

  it('환경 변수가 있으면 그것이 먼저다', () => {
    expect(cassandraEnv({ CASSANDRA_CONTACT_POINTS: '10.0.0.9', HOME: '/x' }, 'CASSANDRA_CONTACT_POINTS=127.0.0.1\nCASSANDRA_KEYSPACE=ars\n'))
      .toEqual({ CASSANDRA_CONTACT_POINTS: '10.0.0.9', CASSANDRA_KEYSPACE: 'ars' })
  })

  it('파일이 없으면(null) 환경 변수만', () => {
    expect(cassandraEnv({ CASSANDRA_PORT: '1' }, null)).toEqual({ CASSANDRA_PORT: '1' })
    expect(cassandraEnv({}, null)).toEqual({})
  })
})

// 최종 검토 I-2: 시험 데이터 도구는 server/.env 의 주소로 Cassandra 에 쓴다 — 사내에서 운영 주소가 든 .env 로 돌려도 쓰지 않게 한다.
describe('assertLocalCassandra — 이 PC 의 Cassandra 에만 쓴다', () => {
  it('루프백 주소는 지난다', () => {
    for (const points of [['127.0.0.1'], ['localhost'], ['LOCALHOST', '127.0.0.2'], ['::1']]) {
      expect(() => assertLocalCassandra(points), points.join()).not.toThrow()
    }
  })

  it('하나라도 루프백이 아니면 던진다 — 문구에 그 호스트를 싣는다', () => {
    for (const points of [['10.1.2.3'], ['127.0.0.1', 'cass-prod-01'], ['127.0.0.1.evil.example'], ['0.0.0.0']]) {
      expect(() => assertLocalCassandra(points), points.join()).toThrow(/루프백/)
    }
    expect(() => assertLocalCassandra(['127.0.0.1', 'cass-prod-01'])).toThrow(/cass-prod-01/)
  })

  it('connectCassandra 는 루프백이 아닌 주소에 연결하지 않고 던진다(계정을 문구에 싣지 않는다)', async () => {
    const env = { CASSANDRA_CONTACT_POINTS: '10.1.2.3,10.1.2.4', CASSANDRA_USERNAME: 'prod_user', CASSANDRA_PASSWORD: 'prod_pw' }
    const e = await connectCassandra(env).then(() => null, (x) => x)
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toMatch(/루프백/)
    expect(e.message).not.toMatch(/prod_user|prod_pw/)
  })
})
