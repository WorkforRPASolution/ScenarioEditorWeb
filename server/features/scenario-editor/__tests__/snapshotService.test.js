// 스냅샷 서비스 — 설비·있는 날·하루 목록·그림 (P3 설계 §5.2~§5.4).
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSnapshotService, DAY_LIMIT, COUNT_LIMIT } = require('../service/snapshotService')
const { createScopeService } = require('../service/scopeService')
const { seError } = require('../errors')

const DAY = 86400000
const kst = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms)
const NOW = kst(2026, 11, 11, 12)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const USER = { singleid: 'u' }
const EQP = [
  { eqpId: 'E2', process: 'CVD', eqpModel: 'M2', line: 'L2', snapshotTimeDiff: 30 },
  { eqpId: 'E1', process: 'CVD', eqpModel: 'M1', line: 'L1', snapshotTimeDiff: 0 },
  { eqpId: 'E3', process: 'CVD', eqpModel: 'M1', line: 'L1' }
]
const click = (ms, x = 1, y = 2) => `${ms}_[${x}][${y}].png`
const caught = async (p) => { try { await p } catch (e) { return e } return null }

// months = { '2026-11': [이름…] } — 저장소처럼 이름 범위로 걸러 오름차순으로 준다. images = { '2026-11-11/이름': base64 }
function fakeRepo({ months = {}, images = {}, truncated = false } = {}) {
  const calls = { listNames: [], latestName: [], imageBase64: [] }
  const of = ({ year, month }) => [...(months[`${year}-${String(month).padStart(2, '0')}`] || [])].sort()
  return {
    calls,
    listNames: async (eqpId, month, fromName, toName, limit) => {
      calls.listNames.push({ eqpId, month, fromName, toName, limit })
      const names = of(month).filter((n) => n >= fromName && n < toName)
      return { names: names.slice(0, limit), truncated: truncated || names.length > limit }
    },
    latestName: async (eqpId, month) => {
      calls.latestName.push({ eqpId, month })
      const names = of(month)
      return names.length ? names[names.length - 1] : null
    },
    imageBase64: async (eqpId, day, fileName) => {
      calls.imageBase64.push({ eqpId, day, fileName })
      const k = `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}/${fileName}`
      return k in images ? images[k] : null
    }
  }
}
function fakeScopes(valid = EQP) {
  return {
    equipmentOf: async (user, eqpId) => {
      const e = valid.find((v) => v.eqpId === eqpId)
      if (!e) throw seError(403, 'EQP_FORBIDDEN', 'x')
      return e
    },
    scopeFor: async () => ({ valid })
  }
}
const service = (repo, { env = {}, now = () => NOW, scopes = fakeScopes() } = {}) => createSnapshotService({ snapshotRepo: repo, scopes, now, env })

describe('snapshotService.equipment', () => {
  it('범위 안 설비를 eqpId 순으로, 모델은 eqpModel', async () => {
    expect(await service(fakeRepo()).equipment(USER)).toEqual([
      { eqpId: 'E1', process: 'CVD', model: 'M1', line: 'L1' },
      { eqpId: 'E2', process: 'CVD', model: 'M2', line: 'L2' },
      { eqpId: 'E3', process: 'CVD', model: 'M1', line: 'L1' }
    ])
  })
})

describe('snapshotService.list — 하루 목록', () => {
  it('범위 밖 설비는 403 EQP_FORBIDDEN 이고 저장소를 부르지 않는다', async () => {
    const repo = fakeRepo()
    const e = await caught(service(repo).list(USER, 'NOPE', '2026-11-11'))
    expect([e.statusCode, e.code]).toEqual([403, 'EQP_FORBIDDEN'])
    expect(repo.calls.listNames).toHaveLength(0)
  })

  it('날짜 꼴이 아니면 400 BAD_REQUEST', async () => {
    const repo = fakeRepo()
    for (const date of ['2026-11-31', '2026-1-1', 'abc', '', undefined]) {
      const e = await caught(service(repo).list(USER, 'E1', date))
      expect([e.statusCode, e.code], String(date)).toEqual([400, 'BAD_REQUEST'])
    }
    expect(repo.calls.listNames).toHaveLength(0)
  })

  it('월 중순은 그 달 한 번, 경계 값은 그 날 0시와 다음 날 0시의 13자리 ms', async () => {
    const repo = fakeRepo()
    await service(repo).list(USER, 'E1', '2026-11-11')
    expect(repo.calls.listNames).toEqual([
      { eqpId: 'E1', month: { year: 2026, month: 11 }, fromName: String(kst(2026, 11, 11)), toName: String(kst(2026, 11, 12)), limit: DAY_LIMIT }
    ])
  })

  it('1일은 앞 달과 그 달 두 번', async () => {
    const repo = fakeRepo()
    await service(repo).list(USER, 'E1', '2026-11-01')
    expect(repo.calls.listNames.map((c) => c.month)).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 11 }])
    expect(repo.calls.listNames.every((c) => c.fromName === String(kst(2026, 11, 1)) && c.toName === String(kst(2026, 11, 2)))).toBe(true)
  })

  it('한 줄의 모양 — 시각·근무조·종류·남은 날, 메모는 null', async () => {
    const ms = kst(2026, 11, 11, 9, 13, 2, 4)
    const txn = kst(2026, 11, 11, 9)
    const repo = fakeRepo({ months: { '2026-11': [click(ms, 412, 388), `${ms + 1000}_[9990][${txn}].png`] } })
    const out = await service(repo).list(USER, 'E1', '2026-11-11')
    expect(out).toEqual({
      eqpId: 'E1', date: '2026-11-11', timeDiff: 0, skipped: 0, truncated: false,
      items: [
        { fileName: click(ms, 412, 388), ms, time: '09:13:02', shift: 'DAY', kind: 'click', tag: null, x: 412, y: 388, txn: null, hasHistory: false, memo: null, daysLeft: 15 },
        { fileName: `${ms + 1000}_[9990][${txn}].png`, ms: ms + 1000, time: '09:13:03', shift: 'DAY', kind: 'tag', tag: 'success', x: null, y: null, txn: String(txn), hasHistory: true, memo: null, daysLeft: 15 }
      ]
    })
  })

  it('꼴이 아닌 이름은 버리고 세며, 범위 밖 ms 는 조용히 뺀다', async () => {
    const inDay = kst(2026, 11, 11, 10)
    const repo = fakeRepo()
    // 저장소가 범위를 지키지 않고 섞어 줘도 걸러진다
    repo.listNames = async () => ({ names: [click(kst(2026, 11, 10, 23, 59, 59, 999)), click(inDay), `${inDay}_bad.png`, `${inDay}_[1][2].PNG`, click(kst(2026, 11, 12))], truncated: false })
    const out = await service(repo).list(USER, 'E1', '2026-11-11')
    expect(out.items.map((i) => i.fileName)).toEqual([click(inDay)])
    expect(out.skipped).toBe(2)
  })

  it('보정 +30 설비는 범위가 30분 앞이고 시각·근무조가 30분 늦다', async () => {
    const ms = kst(2026, 11, 11, 13, 45) // 표시 14:15 SWING
    const prevNight = kst(2026, 11, 10, 23, 40) // 표시 11-11 00:10 GY
    const repo = fakeRepo({ months: { '2026-11': [click(ms), click(prevNight), click(kst(2026, 11, 11, 23, 40))] } })
    const out = await service(repo).list(USER, 'E2', '2026-11-11')
    expect(repo.calls.listNames[0]).toMatchObject({ fromName: String(kst(2026, 11, 10, 23, 30)), toName: String(kst(2026, 11, 11, 23, 30)) })
    expect(out.timeDiff).toBe(30)
    expect(out.items.map((i) => [i.time, i.shift])).toEqual([['00:10:00', 'GY'], ['14:15:00', 'SWING']])
  })

  it('보정값이 없거나 이상하면 0 으로 읽는다', async () => {
    const repo = fakeRepo()
    expect((await service(repo).list(USER, 'E3', '2026-11-11')).timeDiff).toBe(0)
    const odd = fakeScopes([{ eqpId: 'E9', process: 'CVD', eqpModel: 'M', line: 'L', snapshotTimeDiff: 'abc' }])
    expect((await service(repo, { scopes: odd }).list(USER, 'E9', '2026-11-11')).timeDiff).toBe(0)
  })

  it('두 달에서 받은 줄을 ms 순으로 합치고, 같은 이름은 한 번만', async () => {
    const a = kst(2026, 11, 1, 0, 0, 5)
    const b = kst(2026, 11, 1, 8)
    const repo = fakeRepo({ months: { '2026-10': [click(b), click(a)], '2026-11': [click(a, 7, 7), click(b)] } })
    const out = await service(repo).list(USER, 'E1', '2026-11-01')
    expect(out.items.map((i) => i.fileName)).toEqual([click(a), click(a, 7, 7), click(b)])
  })

  it('같은 ms 는 파일 이름 순', async () => {
    const ms = kst(2026, 11, 11, 15, 30)
    const repo = fakeRepo({ months: { '2026-11': [`${ms}_[9999][${ms}].png`, click(ms, 300, 150)] } })
    const out = await service(repo).list(USER, 'E1', '2026-11-11')
    expect(out.items.map((i) => i.kind)).toEqual(['click', 'tag'])
  })

  it('저장소가 truncated 를 주면 그대로 전한다', async () => {
    const out = await service(fakeRepo({ truncated: true })).list(USER, 'E1', '2026-11-11')
    expect(out.truncated).toBe(true)
  })

  it('두 달을 합쳐도 한도를 넘지 않는다 — 둘째 달에는 남은 만큼만 청한다', async () => {
    const repo = fakeRepo({ months: { '2026-10': [click(kst(2026, 11, 1, 1)), click(kst(2026, 11, 1, 2))] } })
    await service(repo).list(USER, 'E1', '2026-11-01')
    expect(repo.calls.listNames.map((c) => c.limit)).toEqual([DAY_LIMIT, DAY_LIMIT - 2])
  })

  it('남은 날은 줄마다 지금 기준으로 센다', async () => {
    const old = kst(2026, 10, 28, 0, 0, 1) // 지금(11-11 12:00) − 14.5일쯤
    const repo = fakeRepo({ months: { '2026-10': [click(old)] } })
    const out = await service(repo).list(USER, 'E1', '2026-10-28')
    expect(out.items[0].daysLeft).toBe(1)
  })

  it('표시 시간대는 SE_DISPLAY_TZ, 틀린 값이면 기본(Asia/Seoul)', async () => {
    const ms = Date.UTC(2026, 10, 11, 0, 13, 2)
    const repo = () => fakeRepo({ months: { '2026-11': [click(ms)] } })
    const utc = await service(repo(), { env: { SE_DISPLAY_TZ: 'UTC' } }).list(USER, 'E1', '2026-11-11')
    expect(utc.items.map((i) => [i.time, i.shift])).toEqual([['00:13:02', 'GY']])
    const bad = await service(repo(), { env: { SE_DISPLAY_TZ: 'Mars/Olympus' } }).list(USER, 'E1', '2026-11-11')
    expect(bad.items.map((i) => i.time)).toEqual(['09:13:02'])
  })

  it('한도 상수', () => {
    expect([DAY_LIMIT, COUNT_LIMIT]).toEqual([50000, 300000])
  })
})

describe('snapshotService.days — 있는 날', () => {
  it('범위 밖 설비는 403 이고 저장소를 부르지 않는다', async () => {
    const repo = fakeRepo()
    expect((await caught(service(repo).days(USER, 'NOPE', {}))).code).toBe('EQP_FORBIDDEN')
    expect(repo.calls.latestName).toHaveLength(0)
  })

  it('counts 없이: 가장 늦은 한 장만 찾고 days 는 null — 늦은 달부터 본다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 9, 10)), click(kst(2026, 11, 10, 23, 50))], '2026-10': [click(kst(2026, 10, 30))] } })
    const out = await service(repo).days(USER, 'E1', {})
    expect(out).toEqual({ eqpId: 'E1', latest: '2026-11-10', days: null, truncated: false })
    expect(repo.calls.latestName).toEqual([{ eqpId: 'E1', month: { year: 2026, month: 11 } }])
    expect(repo.calls.listNames).toHaveLength(0)
  })

  it('이번 달이 비면 앞 달을 본다', async () => {
    const repo = fakeRepo({ months: { '2026-10': [click(kst(2026, 10, 30, 8))] } })
    const out = await service(repo).days(USER, 'E1', {})
    expect(out.latest).toBe('2026-10-30')
    expect(repo.calls.latestName.map((c) => c.month)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 10 }])
  })

  it('가장 늦은 날은 표시 시각(보정 포함)의 날짜다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 10, 23, 50))] } })
    expect((await service(repo).days(USER, 'E2', {})).latest).toBe('2026-11-11')
  })

  it('가장 늦은 이름이 보관 기간 밖이거나 하나도 없으면 latest null', async () => {
    const old = fakeRepo({ months: { '2026-10': [click(NOW - 15 * DAY - 1)] } })
    expect((await service(old).days(USER, 'E1', {})).latest).toBeNull()
    expect((await service(fakeRepo()).days(USER, 'E1', {})).latest).toBeNull()
  })

  it('가장 늦은 이름이 꼴이 아니면 그 달은 건너뛰고 앞 달을 본다', async () => {
    const repo = fakeRepo({ months: { '2026-11': ['zzz.png'], '2026-10': [click(kst(2026, 10, 31, 8))] } })
    expect((await service(repo).days(USER, 'E1', {})).latest).toBe('2026-10-31')
  })

  it('counts: [지금 − 15일, 지금 + 1일) 을 읽어 표시 날짜별로 센다', async () => {
    const names = [
      click(kst(2026, 11, 11, 0, 0, 0)), click(kst(2026, 11, 11, 11)), click(kst(2026, 11, 10, 23, 59, 59, 999)),
      click(kst(2026, 10, 27, 12, 0, 0)), // 꼭 15일 전 — 든다
      click(kst(2026, 10, 27, 11, 59, 59, 999)) // 15일보다 1ms 앞 — 안 든다
    ]
    const repo = fakeRepo({ months: { '2026-11': names.slice(0, 3), '2026-10': names.slice(3) } })
    const out = await service(repo).days(USER, 'E1', { counts: true })
    expect(out).toEqual({ eqpId: 'E1', latest: '2026-11-11', days: { '2026-10-27': 1, '2026-11-10': 1, '2026-11-11': 2 }, truncated: false })
    expect(repo.calls.listNames.map((c) => c.month)).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 11 }])
    expect(repo.calls.listNames[0]).toMatchObject({ fromName: String(NOW - 15 * DAY), toName: String(NOW + DAY), limit: COUNT_LIMIT })
  })

  it('counts: 보정이 있으면 날짜가 그만큼 옮겨진다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 10, 23, 50)), click(kst(2026, 11, 10, 23, 20))] } })
    const out = await service(repo).days(USER, 'E2', { counts: true })
    expect(out.days).toEqual({ '2026-11-10': 1, '2026-11-11': 1 })
  })

  it('counts: 한도에서 멈추면 truncated', async () => {
    const out = await service(fakeRepo({ truncated: true })).days(USER, 'E1', { counts: true })
    expect(out.truncated).toBe(true)
  })
})

describe('snapshotService.image — 그림 한 장', () => {
  const ms = kst(2026, 11, 11, 9)
  const name = click(ms)

  it('범위 밖 설비 403, 파일 이름 꼴 아님 400 SNAPSHOT_BAD_NAME — 저장소를 부르지 않는다', async () => {
    const repo = fakeRepo()
    expect((await caught(service(repo).image(USER, 'NOPE', name))).code).toBe('EQP_FORBIDDEN')
    for (const bad of ['x.png', `${ms}_[1][2].PNG`, '', undefined, `../${name}`]) {
      const e = await caught(service(repo).image(USER, 'E1', bad))
      expect([e.statusCode, e.code], String(bad)).toEqual([400, 'SNAPSHOT_BAD_NAME'])
    }
    expect(repo.calls.imageBase64).toHaveLength(0)
  })

  it('그 날 파티션에서 찾으면 한 번만 묻는다 — PNG 바이트와 남은 보관 초', async () => {
    const repo = fakeRepo({ images: { [`2026-11-11/${name}`]: PNG.toString('base64') } })
    const out = await service(repo).image(USER, 'E1', name)
    expect(out.png.equals(PNG)).toBe(true)
    expect(out.maxAge).toBe(Math.floor((ms + 15 * DAY - NOW) / 1000))
    expect(repo.calls.imageBase64).toEqual([{ eqpId: 'E1', day: { year: 2026, month: 11, day: 11 }, fileName: name }])
  })

  it('그 날에 없으면 앞 날, 뒷날을 차례로 묻는다', async () => {
    const repo = fakeRepo({ images: { [`2026-11-12/${name}`]: PNG.toString('base64') } })
    const out = await service(repo).image(USER, 'E1', name)
    expect(out.png.equals(PNG)).toBe(true)
    expect(repo.calls.imageBase64.map((c) => c.day.day)).toEqual([11, 10, 12])
  })

  it('셋 다 없으면 404 SNAPSHOT_NOT_FOUND', async () => {
    const repo = fakeRepo()
    const e = await caught(service(repo).image(USER, 'E1', name))
    expect([e.statusCode, e.code]).toEqual([404, 'SNAPSHOT_NOT_FOUND'])
    expect(repo.calls.imageBase64).toHaveLength(3)
  })

  it('PNG 서명으로 시작하지 않으면 404 SNAPSHOT_NOT_FOUND', async () => {
    for (const v of [Buffer.from('not a png').toString('base64'), '', '!!!!', 12345]) {
      const repo = fakeRepo({ images: { [`2026-11-11/${name}`]: v } })
      const e = await caught(service(repo).image(USER, 'E1', name))
      expect([e.statusCode, e.code], String(v)).toEqual([404, 'SNAPSHOT_NOT_FOUND'])
    }
  })

  it('파티션 날짜는 SE_SNAPSHOT_PARTITION_TZ 로 계산한다', async () => {
    const early = kst(2026, 11, 11, 3) // UTC 로는 11-10
    const repo = fakeRepo()
    await caught(service(repo, { env: { SE_SNAPSHOT_PARTITION_TZ: 'UTC' } }).image(USER, 'E1', click(early)))
    expect(repo.calls.imageBase64.map((c) => c.day.day)).toEqual([10, 9, 11])
  })

  it('보관 기간이 지난 그림은 maxAge 0', async () => {
    const old = NOW - 16 * DAY
    const day = new Date(old + 9 * 3600000)
    const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}/${click(old)}`
    const out = await service(fakeRepo({ images: { [key]: PNG.toString('base64') } })).image(USER, 'E1', click(old))
    expect(out.maxAge).toBe(0)
  })

  it('날짜로 읽을 수 없는 ms(16자리)는 묻지 않고 404', async () => {
    const repo = fakeRepo()
    const e = await caught(service(repo).image(USER, 'E1', '9999999999999999_[1][2].png'))
    expect([e.statusCode, e.code]).toEqual([404, 'SNAPSHOT_NOT_FOUND'])
    expect(repo.calls.imageBase64).toHaveLength(0)
  })
})

describe('scopeService.equipmentOf — 설비 검사', () => {
  const eq = (eqpId, process, over = {}) => ({ eqpId, category: 'Process', process, line: 'L', lineDesc: 'L', eqpModel: 'M1', ipAddr: eqpId,
    osVer: 'W', emailcategory: 'A-B-C-D', onoff: 1, webmanagerUse: 1, ...over })
  const repo = {
    findAgents: async () => [{ eqpId: 'A' }, { eqpId: 'B' }, { eqpId: 'C' }],
    findEquipment: async () => [eq('A', 'CVD', { snapshotTimeDiff: 5 }), eq('B', 'ETCH'), eq('C', 'CVD', { emailcategory: 'X' })]
  }
  const user = { singleid: 'u', process: 'CVD', processes: ['CVD'], multiProcess: null, isMaster: false }
  const scopes = () => createScopeService({ repo, ttlMs: 60000, now: () => 0 })

  it('범위 안의 유효 설비는 그 문서를 준다', async () => {
    expect(await scopes().equipmentOf(user, 'A')).toMatchObject({ eqpId: 'A', process: 'CVD', snapshotTimeDiff: 5 })
  })

  it('다른 공정·무효 설비·없는 설비·글자가 아닌 값은 403 EQP_FORBIDDEN', async () => {
    for (const id of ['B', 'C', 'NOPE', '', undefined, null, { $ne: '' }, ['A']]) {
      const e = await caught(scopes().equipmentOf(user, id))
      expect([e && e.statusCode, e && e.code], JSON.stringify(id)).toEqual([403, 'EQP_FORBIDDEN'])
    }
  })
})

describe('deps 배선', () => {
  it('build 는 스냅샷 저장소와 서비스를 단다 — Cassandra 에 연결하지 않는다', () => {
    const { build } = require('../deps')
    const out = build({ IMAGE_CACHE_DIR: mkdtempSync(join(tmpdir(), 'sew-build-')) })
    expect(out.snapshotRepo.configured()).toBe(false)
    expect(typeof out.snapshots.list).toBe('function')
    expect(typeof out.snapshots.image).toBe('function')
  })
})
