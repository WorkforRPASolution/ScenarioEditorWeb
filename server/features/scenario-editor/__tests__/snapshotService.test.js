// 스냅샷 서비스 — 설비·있는 날·하루 목록·그림 (P3 설계 §5.2~§5.4).
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSnapshotService, LIST_LIMIT, COUNT_LIMIT, PRESENCE_CHUNK, PRESENCE_TTL_MS, PRESENCE_CONCURRENCY, PRESENCE_BUDGET_MS } = require('../service/snapshotService')
const { createScopeService } = require('../service/scopeService')
const { seError } = require('../errors')

const DAY = 86400000
const kst = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms)
const NOW = kst(2026, 11, 11, 12)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const USER = { singleid: 'u' }
const EQP = [
  { eqpId: 'E2', process: 'CVD', eqpModel: 'M2', line: 'L2', snapshotTimeDiff: 30, ipAddr: '10.0.0.2', ipAddrL: '192.168.0.2' },
  { eqpId: 'E1', process: 'CVD', eqpModel: 'M1', line: 'L1', snapshotTimeDiff: 0, ipAddr: '10.0.0.1', ipAddrL: '' },
  { eqpId: 'E3', process: 'CVD', eqpModel: 'M1', line: 'L1', ipAddr: 10 }
]
const click = (ms, x = 1, y = 2) => `${ms}_[${x}][${y}].png`
const caught = async (p) => { try { await p } catch (e) { return e } return null }

// months = { '2026-11': [이름…] } — 저장소처럼 이름 범위로 걸러 오름차순으로 준다. images = { '2026-11-11/이름': base64 }
function fakeRepo({ months = {}, images = {}, truncated = false } = {}) {
  const calls = { listNames: [], latestName: [], imageBase64: [] }
  const of = ({ year, month }) => [...(months[`${year}-${String(month).padStart(2, '0')}`] || [])].sort()
  return {
    calls,
    // latest = 늦은 것부터(내림차순) — 한도에서 자르면 늦은 것이 남는다
    listNames: async (eqpId, month, fromName, toName, limit, { latest = false } = {}) => {
      calls.listNames.push({ eqpId, month, fromName, toName, limit, ...(latest ? { latest } : {}) })
      const names = of(month).filter((n) => n >= fromName && n < toName)
      if (latest) names.reverse()
      return { names: names.slice(0, limit), truncated: truncated || names.length > limit }
    },
    latestName: async (eqpId, month, fromName) => {
      calls.latestName.push({ eqpId, month, fromName })
      const names = of(month).filter((n) => n >= fromName)
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
  it('범위 안 설비를 eqpId 순으로, 모델은 eqpModel, IP 둘(글자가 아니면 빈 글자)', async () => {
    expect(await service(fakeRepo()).equipment(USER)).toEqual([
      { eqpId: 'E1', process: 'CVD', model: 'M1', line: 'L1', ipAddr: '10.0.0.1', ipAddrL: '' },
      { eqpId: 'E2', process: 'CVD', model: 'M2', line: 'L2', ipAddr: '10.0.0.2', ipAddrL: '192.168.0.2' },
      { eqpId: 'E3', process: 'CVD', model: 'M1', line: 'L1', ipAddr: '', ipAddrL: '' }
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
      { eqpId: 'E1', month: { year: 2026, month: 11 }, fromName: String(kst(2026, 11, 11)), toName: String(kst(2026, 11, 12)), limit: LIST_LIMIT, latest: true }
    ])
  })

  it('1일은 그 달과 앞 달 두 번 — 늦은 달부터 읽는다', async () => {
    const repo = fakeRepo()
    await service(repo).list(USER, 'E1', '2026-11-01')
    expect(repo.calls.listNames.map((c) => c.month)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 10 }])
    expect(repo.calls.listNames.every((c) => c.fromName === String(kst(2026, 11, 1)) && c.toName === String(kst(2026, 11, 2)))).toBe(true)
  })

  it('한 줄의 모양 — 시각·근무조·종류·남은 날, 메모는 null', async () => {
    const ms = kst(2026, 11, 11, 9, 13, 2, 4)
    const txn = kst(2026, 11, 11, 9)
    const repo = fakeRepo({ months: { '2026-11': [click(ms, 412, 388), `${ms + 1000}_[9990][${txn}].png`] } })
    const out = await service(repo).list(USER, 'E1', '2026-11-11')
    expect(out).toEqual({
      eqpId: 'E1', date: '2026-11-11', to: '2026-11-11', timeDiff: 0, skipped: 0, truncated: false, memoFailed: false,
      items: [
        { fileName: click(ms, 412, 388), ms, date: '2026-11-11', time: '09:13:02', shift: 'DAY', kind: 'click', tag: null, x: 412, y: 388, txn: null, hasHistory: false, memo: null, daysLeft: 15 },
        { fileName: `${ms + 1000}_[9990][${txn}].png`, ms: ms + 1000, date: '2026-11-11', time: '09:13:03', shift: 'DAY', kind: 'tag', tag: 'success', x: null, y: null, txn: String(txn), hasHistory: true, memo: null, daysLeft: 15 }
      ]
    })
  })

  it('메모 서비스가 있으면 그 날의 이름 범위로 메모를 받아 줄에 붙이고, 숨김 스냅샷은 목록에서 뺀다', async () => {
    const ms = kst(2026, 11, 11, 9)
    const repo = fakeRepo({ months: { '2026-11': [click(ms), click(ms + 1000), click(ms + 2000)] } })
    const memo = { text: '글', author: 'kim', authorName: '김', writtenAt: '2026-11-11 09:14', editedBy: null, editedAt: null }
    const asked = []
    const memos = { forRange: async (...args) => { asked.push(args); return { byName: new Map([[click(ms), memo]]), hidden: new Set([click(ms + 1000)]), failed: false } } }
    const out = await createSnapshotService({ snapshotRepo: repo, scopes: fakeScopes(), now: () => NOW, env: {}, memos }).list(USER, 'E2', '2026-11-11')
    expect(out.items.map((i) => [i.fileName, i.memo])).toEqual([[click(ms), memo], [click(ms + 2000), null]])
    expect(out.memoFailed).toBe(false)
    // E2 는 보정 +30분 — 메모도 목록과 같은 이름 범위로 읽는다
    expect(asked).toEqual([['E2', String(kst(2026, 11, 10, 23, 30)), String(kst(2026, 11, 11, 23, 30))]])
  })

  it('메모를 읽지 못해도 목록은 준다 — memoFailed 로 알린다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 11, 9))] } })
    const memos = { forRange: async () => ({ byName: new Map(), hidden: new Set(), failed: true }) }
    const out = await createSnapshotService({ snapshotRepo: repo, scopes: fakeScopes(), now: () => NOW, env: {}, memos }).list(USER, 'E1', '2026-11-11')
    expect([out.items.length, out.items[0].memo, out.memoFailed]).toEqual([1, null, true])
  })

  it('범위 밖 설비·틀린 날짜면 메모도 읽지 않는다', async () => {
    let asked = 0
    const memos = { forRange: async () => { asked++; return { byName: new Map(), hidden: new Set(), failed: false } } }
    const s = createSnapshotService({ snapshotRepo: fakeRepo(), scopes: fakeScopes(), now: () => NOW, env: {}, memos })
    await caught(s.list(USER, 'NOPE', '2026-11-11'))
    await caught(s.list(USER, 'E1', 'x'))
    expect(asked).toBe(0)
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

  it('두 달을 합쳐도 한도를 넘지 않는다 — 둘째 달(앞 달)에는 남은 만큼만 청한다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 1, 1)), click(kst(2026, 11, 1, 2))] } })
    await service(repo).list(USER, 'E1', '2026-11-01')
    expect(repo.calls.listNames.map((c) => c.limit)).toEqual([LIST_LIMIT, LIST_LIMIT - 2])
  })

  // ── 여러 날(사내 요청 2026-11-16) ──
  it('to 를 주면 그 날까지 한 번에 — 범위는 첫 날 0시부터 끝 날 다음 0시, 줄마다 표시 날짜가 붙고 응답에 to 가 든다', async () => {
    const a = kst(2026, 11, 9, 23, 59, 59)
    const b = kst(2026, 11, 10, 0, 0, 1)
    const c = kst(2026, 11, 11, 8)
    const repo = fakeRepo({ months: { '2026-11': [click(c), click(a), click(b), click(kst(2026, 11, 12, 0, 0, 1)), click(kst(2026, 11, 8, 23))] } })
    const out = await service(repo).list(USER, 'E1', '2026-11-09', '2026-11-11')
    expect([out.date, out.to]).toEqual(['2026-11-09', '2026-11-11'])
    expect(out.items.map((i) => [i.date, i.time])).toEqual([['2026-11-09', '23:59:59'], ['2026-11-10', '00:00:01'], ['2026-11-11', '08:00:00']])
    expect(repo.calls.listNames.map((x) => [x.fromName, x.toName])).toEqual([[String(kst(2026, 11, 9)), String(kst(2026, 11, 12))]])
  })
  it('달을 걸친 범위는 걸치는 달을 늦은 달부터 읽어 ms 순으로 합친다', async () => {
    const a = kst(2026, 10, 30, 10)
    const b = kst(2026, 11, 2, 10)
    const repo = fakeRepo({ months: { '2026-10': [click(a)], '2026-11': [click(b)] } })
    const out = await service(repo).list(USER, 'E1', '2026-10-30', '2026-11-02')
    expect(repo.calls.listNames.map((x) => x.month)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 10 }])
    expect(out.items.map((i) => i.date)).toEqual(['2026-10-30', '2026-11-02'])
  })
  it('to 가 날짜 꼴이 아니거나 date 보다 앞서거나 범위가 31일을 넘으면 400 — 저장소를 부르지 않는다', async () => {
    const repo = fakeRepo()
    for (const to of ['2026-11-31', 'abc', '2026-11-10', '2026-12-12']) {
      const e = await caught(service(repo).list(USER, 'E1', '2026-11-11', to))
      expect([e.statusCode, e.code, e.details?.path], to).toEqual([400, 'BAD_REQUEST', 'to'])
    }
    expect(repo.calls.listNames).toHaveLength(0)
    // 31일까지는 받는다. 비었으면 하루
    expect((await service(repo).list(USER, 'E1', '2026-11-11', '2026-12-11')).to).toBe('2026-12-11')
    for (const to of [undefined, '', null]) expect((await service(repo).list(USER, 'E1', '2026-11-11', to)).to).toBe('2026-11-11')
  })
  it('한도를 넘으면 늦은 것부터 남긴다 — 화면이 여는 것이 가장 늦은 줄이다', async () => {
    const base = kst(2026, 11, 10, 9)
    const names = Array.from({ length: 5 }, (_, i) => click(base + i * 1000))
    const repo = fakeRepo({ months: { '2026-11': names } })
    repo.listNames = ((inner) => (eqpId, month, f, t, limit, o) => inner(eqpId, month, f, t, Math.min(limit, 3), o))(repo.listNames)
    const out = await service(repo).list(USER, 'E1', '2026-11-10', '2026-11-11')
    expect(out.truncated).toBe(true)
    expect(out.items.map((i) => i.fileName)).toEqual(names.slice(2))
  })
  it('여러 날이면 메모도 그 범위 전체의 이름으로 읽는다', async () => {
    const asked = []
    const memos = { forRange: async (...args) => { asked.push(args); return { byName: new Map(), hidden: new Set(), failed: false } } }
    await createSnapshotService({ snapshotRepo: fakeRepo(), scopes: fakeScopes(), now: () => NOW, env: {}, memos }).list(USER, 'E1', '2026-11-09', '2026-11-11')
    expect(asked).toEqual([['E1', String(kst(2026, 11, 9)), String(kst(2026, 11, 12))]])
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
    expect([LIST_LIMIT, COUNT_LIMIT]).toEqual([100000, 300000])
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
    expect(out).toEqual({ eqpId: 'E1', latest: '2026-11-10', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false })
    // 이름 하한 = 지금 − 15일 — 그보다 앞의 지워진 줄을 훑지 않는다
    expect(repo.calls.latestName).toEqual([{ eqpId: 'E1', month: { year: 2026, month: 11 }, fromName: String(NOW - 15 * DAY) }])
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
    // 저장소가 하한을 지키지 않고 옛 이름을 줘도 걸러진다
    old.latestName = async () => click(NOW - 15 * DAY - 1)
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
    expect(out).toEqual({ eqpId: 'E1', latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: { '2026-10-27': 1, '2026-11-10': 1, '2026-11-11': 2 }, truncated: false })
    expect(repo.calls.listNames.map((c) => c.month)).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 11 }])
    expect(repo.calls.listNames[0]).toMatchObject({ fromName: String(NOW - 15 * DAY), toName: String(NOW + DAY), limit: COUNT_LIMIT })
  })

  it('counts: 보정이 있으면 날짜가 그만큼 옮겨진다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 10, 23, 50)), click(kst(2026, 11, 10, 23, 20))] } })
    const out = await service(repo).days(USER, 'E2', { counts: true })
    expect(out.days).toEqual({ '2026-11-10': 1, '2026-11-11': 1 })
  })

  // 달력이 고를 수 있는 범위(P3-B) — 브라우저 시계·시간대에 기대지 않게 서버가 표시 날짜로 준다
  it('달력 범위: today = 지금의 표시 날짜, oldest = 지금 − 15일의 표시 날짜 (스냅샷이 없어도)', async () => {
    const out = await service(fakeRepo()).days(USER, 'E1', {})
    expect(out).toMatchObject({ latest: null, today: '2026-11-11', oldest: '2026-10-27' })
  })

  it('달력 범위: 보정이 있으면 그만큼 옮겨진다 — +720분이면 낮 12시가 다음 날 0시', async () => {
    const scopes = fakeScopes([{ eqpId: 'E9', process: 'CVD', eqpModel: 'M1', line: 'L1', snapshotTimeDiff: 720 }])
    const out = await service(fakeRepo(), { scopes }).days(USER, 'E9', { counts: true })
    expect(out).toMatchObject({ today: '2026-11-12', oldest: '2026-10-28' })
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

describe('snapshotService.presence — 설비마다 가장 늦은 스냅샷 날짜', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ eqpId: `B${String(i).padStart(5, '0')}`, process: 'CVD', eqpModel: 'M1', line: 'L1' }))
  // 조회가 끝나는 때를 시험이 정하는 저장소 — 한꺼번에 떠 있는 조회 수를 센다
  function slowRepo(names = {}) {
    const state = { calls: [], flying: 0, peak: 0 }
    return {
      state,
      latestName: async (eqpId) => {
        state.calls.push(eqpId)
        state.flying++
        state.peak = Math.max(state.peak, state.flying)
        await new Promise((r) => setTimeout(r, 1))
        state.flying--
        return names[eqpId] ?? null
      }
    }
  }

  it('내 범위 설비를 eqpId 순으로 보고, 스냅샷이 있는 설비만 [설비, 표시 날짜] 로 준다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 10, 23, 50))] } })
    const r = await service(repo).presence(USER)
    // 가짜 저장소는 설비를 가리지 않는다 — 셋 다 같은 이름을 받고, E2 는 보정 +30분이라 다음 날이다
    expect(r).toEqual({ enabled: true, items: [['E1', '2026-11-10'], ['E2', '2026-11-11'], ['E3', '2026-11-10']], checked: 3, total: 3, next: null })
    expect(repo.calls.latestName.map((c) => c.eqpId)).toEqual(['E1', 'E2', 'E3'])
    expect(repo.calls.listNames).toEqual([])
  })

  it('있는 날과 같은 조회 — 이름 하한은 지금 − 15일, 늦은 달이 비면 앞 달을 본다. 없으면 싣지 않는다', async () => {
    const repo = fakeRepo({ months: { '2026-10': [click(kst(2026, 10, 30, 9))] } })
    const r = await service(repo, { scopes: fakeScopes([EQP[1]]) }).presence(USER)
    expect(r.items).toEqual([['E1', '2026-10-30']])
    expect(repo.calls.latestName).toEqual([
      { eqpId: 'E1', month: { year: 2026, month: 11 }, fromName: String(NOW - 15 * DAY) },
      { eqpId: 'E1', month: { year: 2026, month: 10 }, fromName: String(NOW - 15 * DAY) }
    ])
    const none = await service(fakeRepo(), { scopes: fakeScopes([EQP[1]]) }).presence(USER)
    expect(none).toEqual({ enabled: true, items: [], checked: 1, total: 1, next: null })
  })

  it('기억하는 동안(10분)은 다시 묻지 않는다 — 사용자가 달라도 같은 기억을 쓴다', async () => {
    let at = NOW
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 11, 9))] } })
    const s = service(repo, { now: () => at, scopes: fakeScopes([EQP[1]]) })
    await s.presence(USER)
    at += PRESENCE_TTL_MS - 1
    expect((await s.presence({ singleid: 'other' })).items).toEqual([['E1', '2026-11-11']])
    expect(repo.calls.latestName).toHaveLength(1)
    at += 1
    await s.presence(USER)
    expect(repo.calls.latestName).toHaveLength(2)
    expect(PRESENCE_TTL_MS).toBe(10 * 60000) // 화면이 다시 받는 주기(5분)보다 길다 — 다시 받을 때마다 전부 다시 묻지 않게
  })

  it('시계가 뒤로 가면 기억을 쓰지 않고 다시 묻는다', async () => {
    let at = NOW
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 11, 9))] } })
    const s = service(repo, { now: () => at, scopes: fakeScopes([EQP[1]]) })
    await s.presence(USER)
    at -= 60000
    expect((await s.presence(USER)).items).toEqual([['E1', '2026-11-11']])
    expect(repo.calls.latestName).toHaveLength(2)
  })

  it('기억은 설비의 값이지 사용자의 것이 아니다 — 범위가 다른 사용자에게는 자기 범위 설비만 간다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 11, 9))] } })
    const scopes = { scopeFor: async (u) => ({ valid: u.singleid === 'wide' ? EQP : [EQP[1]] }) }
    const s = service(repo, { scopes })
    expect((await s.presence({ singleid: 'wide' })).items.map(([id]) => id)).toEqual(['E1', 'E2', 'E3'])
    const narrow = await s.presence({ singleid: 'narrow' })
    expect(narrow).toEqual({ enabled: true, items: [['E1', '2026-11-11']], checked: 1, total: 1, next: null })
    expect(repo.calls.latestName).toHaveLength(3) // 좁은 범위는 기억만 썼다
  })

  it('eqpId 가 글자가 아닌 설비 문서는 보지 않는다(저장소에 글자가 아닌 값을 보내지 않는다)', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(kst(2026, 11, 11, 9))] } })
    const r = await service(repo, { scopes: fakeScopes([{ eqpId: 7, process: 'CVD', eqpModel: 'M1' }, EQP[1], { eqpId: '', process: 'CVD', eqpModel: 'M1' }]) }).presence(USER)
    expect(r).toEqual({ enabled: true, items: [['E1', '2026-11-11']], checked: 1, total: 1, next: null })
    expect(repo.calls.latestName.map((c) => c.eqpId)).toEqual(['E1'])
  })

  it('한 요청은 시간 예산까지만 묻는다 — 거기까지의 next 를 주고, 이어 청하면 남은 설비만 묻는다', async () => {
    let at = NOW
    const calls = []
    const repo = { latestName: async (eqpId) => { calls.push(eqpId); at += 600; return null } } // 조회 하나에 0.6초
    const s = service(repo, { now: () => at, scopes: fakeScopes(many(100)), env: { SE_SNAPSHOT_PRESENCE_CONCURRENCY: '1' } })
    const first = await s.presence(USER)
    expect(first.total).toBe(100)
    expect(first.checked).toBeGreaterThanOrEqual(1)
    expect(first.checked).toBeLessThanOrEqual(Math.ceil(PRESENCE_BUDGET_MS / 1200) + 1)
    expect(first.next).toBe(`B${String(first.checked - 1).padStart(5, '0')}`)
    let r = first
    let requests = 1
    while (r.next) { r = await s.presence(USER, r.next); requests++ }
    expect(r.checked).toBe(100)
    expect(requests).toBeGreaterThan(10)
    expect(calls).toHaveLength(200) // 100대 × 두 달 — 겹쳐 묻지 않았다
    expect(PRESENCE_BUDGET_MS).toBe(5000)
  })

  it('다 기억하고 있는 요청은 줄을 서지 않는다 — 앞 요청이 저장소를 기다리는 동안에도 바로 답한다', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    let slow = false
    const repo = { latestName: async () => { if (slow) await gate; return null } }
    const scopes = { scopeFor: async (u) => ({ valid: u.singleid === 'cold' ? many(5) : [EQP[1]] }) }
    const s = service(repo, { scopes })
    await s.presence({ singleid: 'warm' })
    slow = true
    const cold = s.presence({ singleid: 'cold' })
    expect((await s.presence({ singleid: 'warm' })).checked).toBe(1)
    release()
    expect((await cold).checked).toBe(5)
  })

  it('기억해 둔 한 장이 그 사이 보관 기간을 벗어나면 싣지 않는다', async () => {
    let at = NOW
    const repo = fakeRepo({ months: { '2026-10': [click(NOW - 15 * DAY + 60000)] } })
    const s = service(repo, { now: () => at, scopes: fakeScopes([EQP[1]]) })
    expect((await s.presence(USER)).items).toHaveLength(1)
    at += 120000
    expect((await s.presence(USER)).items).toEqual([])
  })

  it('한 번에 PRESENCE_CHUNK 대까지 — next 를 after 로 주면 이어서 본다', async () => {
    const repo = slowRepo({ B00000: click(NOW - 1000), B02003: click(NOW - 2000) })
    const s = service(repo, { scopes: fakeScopes(many(PRESENCE_CHUNK + 5)) })
    const first = await s.presence(USER)
    expect([first.checked, first.total, first.next]).toEqual([PRESENCE_CHUNK, PRESENCE_CHUNK + 5, `B${String(PRESENCE_CHUNK - 1).padStart(5, '0')}`])
    expect(first.items).toEqual([['B00000', '2026-11-11']])
    const rest = await s.presence(USER, first.next)
    expect([rest.checked, rest.total, rest.next]).toEqual([PRESENCE_CHUNK + 5, PRESENCE_CHUNK + 5, null])
    expect(rest.items).toEqual([['B02003', '2026-11-11']])
    // after 가 목록에 없는 글자여도(그 사이 설비가 빠짐) 그보다 뒤의 설비부터 본다
    expect((await s.presence(USER, 'B02002x')).items).toEqual([['B02003', '2026-11-11']])
    expect((await s.presence(USER, 'ZZZ'))).toEqual({ enabled: true, items: [], checked: PRESENCE_CHUNK + 5, total: PRESENCE_CHUNK + 5, next: null })
  })

  it('한꺼번에 보내는 조회는 정한 수까지 — 두 요청이 함께 와도 줄을 서고, 뒤 요청은 기억을 쓴다', async () => {
    const repo = slowRepo()
    const s = service(repo, { scopes: fakeScopes(many(60)), env: { SE_SNAPSHOT_PRESENCE_CONCURRENCY: '4' } })
    const [a, b] = await Promise.all([s.presence(USER), s.presence({ singleid: 'other' })])
    expect(repo.state.peak).toBe(4)
    expect(repo.state.calls).toHaveLength(120) // 60대 × 두 달(둘 다 빔) — 두 요청이어도 한 번씩만
    expect([a.checked, b.checked]).toEqual([60, 60])
  })

  it('기본은 한꺼번에 8, 틀린 값이면 기본으로(한 번 알린다), 64 보다 크면 64', async () => {
    for (const env of [{}, { SE_SNAPSHOT_PRESENCE_CONCURRENCY: 'many' }, { SE_SNAPSHOT_PRESENCE_CONCURRENCY: '-1' }]) {
      const repo = slowRepo()
      const warned = []
      const s = createSnapshotService({ snapshotRepo: repo, scopes: fakeScopes(many(80)), now: () => NOW, env, log: { warn: (m) => warned.push(m) } })
      await s.presence(USER)
      expect(repo.state.peak, JSON.stringify(env)).toBe(PRESENCE_CONCURRENCY)
      expect(warned.length, JSON.stringify(env)).toBe(env.SE_SNAPSHOT_PRESENCE_CONCURRENCY ? 1 : 0)
    }
    expect(PRESENCE_CONCURRENCY).toBe(8)
    const repo = slowRepo()
    await service(repo, { scopes: fakeScopes(many(300)), env: { SE_SNAPSHOT_PRESENCE_CONCURRENCY: '100' } }).presence(USER)
    expect(repo.state.peak).toBe(64)
  })

  it('SE_SNAPSHOT_PRESENCE_CONCURRENCY=0 이면 끈다 — 저장소를 부르지 않는다', async () => {
    const repo = fakeRepo({ months: { '2026-11': [click(NOW - 1000)] } })
    const r = await service(repo, { env: { SE_SNAPSHOT_PRESENCE_CONCURRENCY: '0' } }).presence(USER)
    expect(r).toEqual({ enabled: false, items: [], checked: 0, total: 3, next: null })
    expect(repo.calls.latestName).toEqual([])
  })

  it('저장소가 실패하면 첫 조회 하나로 끝난다 — 오류를 그대로 던지고 기억하지 않는다', async () => {
    let down = true
    const calls = []
    const repo = {
      latestName: async (eqpId) => {
        calls.push(eqpId)
        if (down) throw seError(503, 'SNAPSHOT_DOWN', 'x')
        return null
      }
    }
    const s = service(repo, { scopes: fakeScopes(many(40)) })
    expect((await caught(s.presence(USER))).code).toBe('SNAPSHOT_DOWN')
    expect(calls).toEqual(['B00000'])
    down = false
    expect((await s.presence(USER)).checked).toBe(40)
    expect(calls).toHaveLength(1 + 80)
  })

  it('가운데에서 실패하면 남은 설비는 묻지 않고, 그때까지 받은 것은 기억한다', async () => {
    const calls = []
    let fail = true
    const repo = {
      latestName: async (eqpId) => {
        calls.push(eqpId)
        await new Promise((r) => setTimeout(r, 1))
        if (fail && eqpId === 'B00010') throw seError(504, 'SNAPSHOT_TIMEOUT', 'x')
        return null
      }
    }
    const s = service(repo, { scopes: fakeScopes(many(200)), env: { SE_SNAPSHOT_PRESENCE_CONCURRENCY: '2' } })
    expect((await caught(s.presence(USER))).code).toBe('SNAPSHOT_TIMEOUT')
    const asked = new Set(calls)
    expect(asked.size).toBeLessThan(20)
    fail = false
    calls.length = 0
    await s.presence(USER)
    expect(calls).not.toContain('B00000') // 앞에서 받은 설비는 다시 묻지 않는다
    expect(new Set(calls).has('B00010')).toBe(true)
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
    expect(typeof out.memos.save).toBe('function')
  })
})
