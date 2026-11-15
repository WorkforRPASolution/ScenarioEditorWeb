// 메모 서비스 — 쓰기·고치기·지우기·충돌, 하루치 읽기, 메모 목록 (P3 설계 §4.4·§4.5·§5.5)
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createMemoService, MEMO_LIST_LIMIT } = require('../service/memoService')
const { seError } = require('../errors')

const DAY = 86400000
const kst = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms)
const NOW = kst(2026, 11, 11, 12)
const name = (ms, x = 1, y = 2) => `${ms}_[${x}][${y}].png`
const T1 = kst(2026, 11, 11, 9, 13, 2)
const T2 = kst(2026, 11, 10, 23, 50)
const N1 = name(T1)
const N2 = name(T2)
const EQP = [
  { eqpId: 'E1', process: 'CVD', eqpModel: 'M1', line: 'L1', snapshotTimeDiff: 0 },
  { eqpId: 'E2', process: 'ETCH', eqpModel: 'M2', line: 'L1', snapshotTimeDiff: 30 }
]
const KIM = { singleid: 'kim', name: '김철수' }
const LEE = { singleid: 'lee', name: '이영희' }
const caught = async (p) => { try { await p } catch (e) { return e } return null }
const memoDoc = (over = {}) => ({ singleid: 'kim', eqpid: 'E1', snapshotTimestamp: new Date(T1 + 60000), process: 'CVD', memo: '알람 창이 가려짐', filename: N1, hiddensnapshot: '0', ...over })

// 저장소처럼 움직이는 가짜 — 문서는 docs 에 있고 호출을 기록한다. hooks.beforeWrite 는 쓰기 직전에 불린다(그 사이 남이 바꾼 것을 흉내).
function fakeRepo(initial = [], { users = { kim: '김철수', lee: '이영희' }, hooks = {}, fail = {} } = {}) {
  let seq = 0
  const docs = initial.map((d) => ({ _id: d._id ?? `id${++seq}`, ...d }))
  const calls = []
  const repo = {
    docs, calls,
    findMemos: async ({ eqpId, fromName, toName }, limit) => {
      calls.push(['findMemos', { eqpId, fromName, toName }, limit])
      if (fail.findMemos) throw fail.findMemos
      return docs
        .filter((d) => (eqpId === undefined || d.eqpid === eqpId) && typeof d.filename === 'string' && d.filename >= fromName && (toName === undefined || d.filename < toName))
        .sort((a, b) => (a.filename < b.filename ? 1 : a.filename > b.filename ? -1 : 0)).slice(0, limit)
    },
    findMemosByKey: async (eqpId, fileName) => { calls.push(['findMemosByKey', eqpId, fileName]); return docs.filter((d) => d.eqpid === eqpId && d.filename === fileName) },
    insertMemoIfAbsent: async (doc) => {
      calls.push(['insertMemoIfAbsent', doc])
      if (hooks.beforeWrite) hooks.beforeWrite(docs)
      if (docs.some((d) => d.eqpid === doc.eqpid && d.filename === doc.filename)) return { inserted: false }
      docs.push({ _id: `id${++seq}`, ...doc })
      return { inserted: true }
    },
    updateMemoText: async (id, expect, set) => {
      calls.push(['updateMemoText', id, expect, set])
      if (hooks.beforeWrite) hooks.beforeWrite(docs)
      const d = docs.find((x) => x._id === id && x.memo === expect)
      if (!d) return { matched: 0 }
      Object.assign(d, set)
      return { matched: 1 }
    },
    deleteMemo: async (id, expect) => {
      calls.push(['deleteMemo', id, expect])
      if (hooks.beforeWrite) hooks.beforeWrite(docs)
      const i = docs.findIndex((x) => x._id === id && x.memo === expect)
      if (i < 0) return { deleted: 0 }
      docs.splice(i, 1)
      return { deleted: 1 }
    },
    findUserNames: async (ids) => {
      calls.push(['findUserNames', ids])
      if (fail.findUserNames) throw fail.findUserNames
      return ids.filter((id) => users[id] !== undefined).map((id) => ({ singleid: id, name: users[id] }))
    }
  }
  return repo
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
const service = (repo, { now = () => NOW, scopes = fakeScopes(), env = {}, log = null } = {}) => createMemoService({ repo, scopes, now, env, log })
const range = [String(kst(2026, 11, 11)), String(kst(2026, 11, 12))]

describe('memoService.forRange — 하루치 메모', () => {
  it('그 설비·이름 범위의 메모를 파일 이름으로 — 글·작성자·이름·쓴 때(표시 시간대, 분까지)', async () => {
    const repo = fakeRepo([memoDoc(), memoDoc({ eqpid: 'E2' }), memoDoc({ filename: N2, memo: '어제 것' })])
    const r = await service(repo).forRange('E1', ...range)
    expect(r.failed).toBe(false)
    expect([...r.byName]).toEqual([[N1, { text: '알람 창이 가려짐', author: 'kim', authorName: '김철수', writtenAt: '2026-11-11 09:14', editedBy: null, editedAt: null }]])
    expect(r.hidden.size).toBe(0)
    expect(repo.calls[0]).toEqual(['findMemos', { eqpId: 'E1', fromName: range[0], toName: range[1] }, 5000])
  })
  it('웹이 고친 메모는 고친 사람·때가 붙는다. 이름을 모르는 작성자는 아이디, 작성자가 없으면 빈 글자', async () => {
    const repo = fakeRepo([
      memoDoc({ singleid: 'ghost', webEditedBy: 'lee', webEditedAt: new Date(kst(2026, 11, 11, 10, 2, 59)) }),
      memoDoc({ filename: name(T1 + 1), singleid: undefined, snapshotTimestamp: 'x' })
    ])
    const r = await service(repo).forRange('E1', ...range)
    expect(r.byName.get(N1)).toMatchObject({ author: 'ghost', authorName: 'ghost', editedBy: 'lee', editedAt: '2026-11-11 10:02' })
    expect(r.byName.get(name(T1 + 1))).toMatchObject({ author: '', authorName: '', writtenAt: null })
  })
  it('틀린 문서는 그 건만 건너뛰고 알린다 — 나머지는 읽는다(DC-082)', async () => {
    const warned = []
    const repo = fakeRepo([memoDoc({ memo: 7 }), memoDoc({ filename: `${T1}_x.png` }), memoDoc({ filename: name(T1 + 5), memo: '멀쩡' })])
    const r = await service(repo, { log: { warn: (m) => warned.push(m) } }).forRange('E1', ...range)
    expect([...r.byName.keys()]).toEqual([name(T1 + 5)])
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('2')
  })
  it('같은 키 문서가 여럿이면 가장 늦게 쓴 것', async () => {
    const repo = fakeRepo([memoDoc({ memo: '먼저', snapshotTimestamp: new Date(T1 + 1000) }), memoDoc({ memo: '나중', snapshotTimestamp: new Date(T1 + 9000) })])
    expect((await service(repo).forRange('E1', ...range)).byName.get(N1).text).toBe('나중')
  })
  it('숨김("1")인 메모의 스냅샷은 hidden 에 넣고 메모로는 주지 않는다', async () => {
    const repo = fakeRepo([memoDoc({ hiddensnapshot: '1' }), memoDoc({ filename: name(T1 + 5), hiddensnapshot: '2026-11-11 오전 9:00:00' })])
    const r = await service(repo).forRange('E1', ...range)
    expect([...r.hidden]).toEqual([N1])
    expect([...r.byName.keys()]).toEqual([name(T1 + 5)])
  })
  it('읽지 못하면 던지지 않고 failed — 이름을 못 찾아도 메모는 준다(아이디로)', async () => {
    const warned = []
    const r = await service(fakeRepo([memoDoc()], { fail: { findMemos: new Error('not authorized on EARS') } }), { log: { warn: (m) => warned.push(m) } }).forRange('E1', ...range)
    expect([r.failed, r.byName.size, r.hidden.size]).toEqual([true, 0, 0])
    expect(warned).toHaveLength(1)
    const named = await service(fakeRepo([memoDoc()], { fail: { findUserNames: new Error('x') } })).forRange('E1', ...range)
    expect([named.failed, named.byName.get(N1).authorName]).toEqual([false, 'kim'])
  })
})

describe('memoService.save — 새 메모', () => {
  it('일곱 필드 문서를 넣는다 — 작성자·쓴 때(지금)·그 설비의 지금 공정·숨김 "0"', async () => {
    const repo = fakeRepo()
    const r = await service(repo).save(LEE, 'E1', N1, { memo: '  새 메모  ', expect: null })
    expect(r).toEqual({ memo: { text: '새 메모', author: 'lee', authorName: '이영희', writtenAt: '2026-11-11 12:00', editedBy: null, editedAt: null } })
    const { _id, ...doc } = repo.docs[0]
    expect(doc).toEqual({ singleid: 'lee', eqpid: 'E1', snapshotTimestamp: new Date(NOW), process: 'CVD', memo: '새 메모', filename: N1, hiddensnapshot: '0' })
    expect(Object.keys(doc)).toEqual(['singleid', 'eqpid', 'snapshotTimestamp', 'process', 'memo', 'filename', 'hiddensnapshot'])
  })
  it('expect 가 없어도(undefined) 새 메모다', async () => {
    const repo = fakeRepo()
    await service(repo).save(LEE, 'E1', N1, { memo: '글' })
    expect(repo.docs).toHaveLength(1)
  })
  it('같은 키 문서가 이미 있으면 409 MEMO_CONFLICT 와 지금 값 — 덮어쓰지 않는다(DC-036)', async () => {
    const repo = fakeRepo([memoDoc()])
    const e = await caught(service(repo).save(LEE, 'E1', N1, { memo: '내 것', expect: null }))
    expect([e.statusCode, e.code]).toEqual([409, 'MEMO_CONFLICT'])
    expect(e.details).toEqual({ current: { text: '알람 창이 가려짐', author: 'kim', authorName: '김철수', writtenAt: '2026-11-11 09:14', editedBy: null, editedAt: null } })
    expect(repo.docs).toHaveLength(1)
    expect(repo.docs[0]).toMatchObject({ memo: '알람 창이 가려짐', singleid: 'kim' })
  })
  it('글 규칙: 빈 글 MEMO_EMPTY · 작은따옴표 MEMO_QUOTE · 129자 MEMO_TOO_LONG — 저장소에 쓰지 않는다', async () => {
    const repo = fakeRepo()
    for (const [memo, code] of [['   ', 'MEMO_EMPTY'], [7, 'MEMO_EMPTY'], ["a'b", 'MEMO_QUOTE'], ['가'.repeat(129), 'MEMO_TOO_LONG']]) {
      const e = await caught(service(repo).save(LEE, 'E1', N1, { memo, expect: null }))
      expect([e.statusCode, e.code], code).toEqual([400, code])
    }
    expect(repo.calls.filter((c) => c[0] !== 'findMemosByKey')).toEqual([])
  })
  it('범위 밖 설비 403 · 파일 이름 꼴 아님 400 SNAPSHOT_BAD_NAME · 15일이 지난 스냅샷 404 SNAPSHOT_NOT_FOUND — 저장소를 부르지 않는다', async () => {
    const repo = fakeRepo()
    const s = service(repo)
    expect((await caught(s.save(LEE, 'NOPE', N1, { memo: '글', expect: null }))).code).toBe('EQP_FORBIDDEN')
    expect((await caught(s.save(LEE, 'E1', 'memo.bin', { memo: '글', expect: null }))).code).toBe('SNAPSHOT_BAD_NAME')
    const old = await caught(s.save(LEE, 'E1', name(NOW - 15 * DAY - 1), { memo: '글', expect: null }))
    expect([old.statusCode, old.code]).toEqual([404, 'SNAPSHOT_NOT_FOUND'])
    await s.save(LEE, 'E1', name(NOW - 15 * DAY), { memo: '경계', expect: null })
    expect(repo.calls.map((c) => c[0])).toEqual(['insertMemoIfAbsent'])
  })
})

describe('memoService.save — 고치기', () => {
  it('본 글이 지금 값과 같으면 글만 바꾸고 고친 사람·때를 적는다 — 작성자·쓴 때·공정·숨김은 그대로', async () => {
    const before = memoDoc({ process: 'OLDPROC' })
    const repo = fakeRepo([before])
    const r = await service(repo).save(LEE, 'E1', N1, { memo: '고친 글', expect: '알람 창이 가려짐' })
    expect(r.memo).toEqual({ text: '고친 글', author: 'kim', authorName: '김철수', writtenAt: '2026-11-11 09:14', editedBy: 'lee', editedAt: '2026-11-11 12:00' })
    const { _id, ...doc } = repo.docs[0]
    expect(doc).toEqual({ ...before, memo: '고친 글', webEditedBy: 'lee', webEditedAt: new Date(NOW) })
  })
  it('데스크톱이 쓴 문서(쓴 때가 글자, 숨김 값이 엉뚱함)도 나머지 필드를 그대로 둔다', async () => {
    const before = memoDoc({ snapshotTimestamp: '2026-11-11 오전 9:14:02', hiddensnapshot: '2026-11-11 오전 9:14:02' })
    const repo = fakeRepo([before])
    await service(repo).save(LEE, 'E1', N1, { memo: '고친 글', expect: before.memo })
    expect(repo.docs[0]).toMatchObject({ singleid: 'kim', snapshotTimestamp: '2026-11-11 오전 9:14:02', hiddensnapshot: '2026-11-11 오전 9:14:02', process: 'CVD', memo: '고친 글' })
  })
  it('본 글이 지금 값과 다르면 409 와 지금 값 — 쓰지 않는다', async () => {
    const repo = fakeRepo([memoDoc({ memo: '남이 바꾼 글' })])
    const e = await caught(service(repo).save(LEE, 'E1', N1, { memo: '내 글', expect: '알람 창이 가려짐' }))
    expect([e.statusCode, e.code, e.details.current.text]).toEqual([409, 'MEMO_CONFLICT', '남이 바꾼 글'])
    expect(repo.calls.some((c) => c[0] === 'updateMemoText')).toBe(false)
  })
  it('그 사이 지워졌으면 409 이고 지금 값은 null', async () => {
    const e = await caught(service(fakeRepo()).save(LEE, 'E1', N1, { memo: '내 글', expect: '알람 창이 가려짐' }))
    expect([e.code, e.details]).toEqual(['MEMO_CONFLICT', { current: null }])
  })
  it('읽은 뒤 쓰기 전에 남이 바꾸면(조건에 안 맞음) 409 와 새로 읽은 지금 값', async () => {
    const repo = fakeRepo([memoDoc()], { hooks: { beforeWrite: (docs) => { docs[0].memo = '방금 바뀜' } } })
    const e = await caught(service(repo).save(LEE, 'E1', N1, { memo: '내 글', expect: '알람 창이 가려짐' }))
    expect([e.code, e.details.current.text]).toEqual(['MEMO_CONFLICT', '방금 바뀜'])
    expect(repo.docs[0].memo).toBe('방금 바뀜')
  })
  it('글이 그대로면 쓰지 않고 지금 값을 준다(고친 사람을 바꾸지 않는다)', async () => {
    const repo = fakeRepo([memoDoc()])
    const r = await service(repo).save(LEE, 'E1', N1, { memo: ' 알람 창이 가려짐 ', expect: '알람 창이 가려짐' })
    expect(r.memo).toMatchObject({ text: '알람 창이 가려짐', editedBy: null })
    expect(repo.calls.some((c) => c[0] === 'updateMemoText')).toBe(false)
  })
  it('같은 키 문서가 여럿이면 가장 늦게 쓴 하나만 고친다', async () => {
    const repo = fakeRepo([memoDoc({ _id: 'old', memo: '먼저', snapshotTimestamp: new Date(T1) }), memoDoc({ _id: 'new', memo: '나중', snapshotTimestamp: new Date(T1 + 5000) })])
    await service(repo).save(LEE, 'E1', N1, { memo: '고침', expect: '나중' })
    expect(repo.docs.map((d) => [d._id, d.memo])).toEqual([['old', '먼저'], ['new', '고침']])
  })
  it('expect 가 글자·null 이 아니면 400 BAD_REQUEST', async () => {
    const e = await caught(service(fakeRepo([memoDoc()])).save(LEE, 'E1', N1, { memo: '글', expect: 7 }))
    expect([e.statusCode, e.code]).toEqual([400, 'BAD_REQUEST'])
  })
})

describe('memoService.remove — 지우기', () => {
  it('본 글이 지금 값과 같으면 그 문서를 지운다 — 설비 공정이 바뀌어 문서의 process 와 달라도 지운다(DC-081)', async () => {
    const repo = fakeRepo([memoDoc({ process: 'OLDPROC' }), memoDoc({ filename: N2, memo: '다른 것' })])
    expect(await service(repo).remove(LEE, 'E1', N1, { expect: '알람 창이 가려짐' })).toEqual({ removed: true, memo: null })
    expect(repo.docs.map((d) => d.filename)).toEqual([N2])
  })
  it('본 글이 다르면 409 와 지금 값 — 지우지 않는다', async () => {
    const repo = fakeRepo([memoDoc({ memo: '남이 바꾼 글' })])
    const e = await caught(service(repo).remove(LEE, 'E1', N1, { expect: '알람 창이 가려짐' }))
    expect([e.statusCode, e.code, e.details.current.text]).toEqual([409, 'MEMO_CONFLICT', '남이 바꾼 글'])
    expect(repo.docs).toHaveLength(1)
  })
  it('이미 없으면 404 MEMO_GONE', async () => {
    const e = await caught(service(fakeRepo()).remove(LEE, 'E1', N1, { expect: '알람 창이 가려짐' }))
    expect([e.statusCode, e.code]).toEqual([404, 'MEMO_GONE'])
  })
  it('읽은 뒤 지우기 전에 남이 지웠으면 404 MEMO_GONE, 남이 바꿨으면 409', async () => {
    const gone = fakeRepo([memoDoc()], { hooks: { beforeWrite: (docs) => { docs.length = 0 } } })
    expect((await caught(service(gone).remove(LEE, 'E1', N1, { expect: '알람 창이 가려짐' }))).code).toBe('MEMO_GONE')
    const changed = fakeRepo([memoDoc()], { hooks: { beforeWrite: (docs) => { docs[0].memo = '방금 바뀜' } } })
    const e = await caught(service(changed).remove(LEE, 'E1', N1, { expect: '알람 창이 가려짐' }))
    expect([e.code, e.details.current.text]).toEqual(['MEMO_CONFLICT', '방금 바뀜'])
  })
  it('같은 키 문서가 여럿이면 가장 늦게 쓴 하나만 지우고, 남은 것을 알려 준다', async () => {
    const repo = fakeRepo([memoDoc({ _id: 'old', memo: '먼저', snapshotTimestamp: new Date(T1) }), memoDoc({ _id: 'new', memo: '나중', snapshotTimestamp: new Date(T1 + 5000) })])
    const r = await service(repo).remove(LEE, 'E1', N1, { expect: '나중' })
    expect([r.removed, r.memo.text]).toEqual([true, '먼저'])
    expect(repo.docs.map((d) => d._id)).toEqual(['old'])
  })
  it('범위 밖 설비 403 · 파일 이름 꼴 아님 400 · expect 가 글자가 아니면 400 BAD_REQUEST', async () => {
    const s = service(fakeRepo([memoDoc()]))
    expect((await caught(s.remove(LEE, 'NOPE', N1, { expect: 'x' }))).code).toBe('EQP_FORBIDDEN')
    expect((await caught(s.remove(LEE, 'E1', 'x.png', { expect: 'x' }))).code).toBe('SNAPSHOT_BAD_NAME')
    expect((await caught(s.remove(LEE, 'E1', N1, { expect: null }))).code).toBe('BAD_REQUEST')
  })
})

describe('memoService.list — 메모 목록', () => {
  it('내 범위 설비의 메모만 — 설비의 지금 공정·모델, 스냅샷 표시 시각(설비 보정), 남은 날, 쓴 때 내림차순', async () => {
    const repo = fakeRepo([
      memoDoc({ snapshotTimestamp: new Date(T1 + 60000) }),
      memoDoc({ eqpid: 'E2', filename: N2, memo: '보정 설비', snapshotTimestamp: new Date(T1 + 120000), process: 'WRONG' }),
      memoDoc({ eqpid: 'OTHER', memo: '남의 범위' })
    ])
    const r = await service(repo).list(KIM)
    expect(r.truncated).toBe(false)
    expect(r.items).toEqual([
      { eqpId: 'E2', process: 'ETCH', model: 'M2', fileName: N2, date: '2026-11-11', time: '00:20:00', daysLeft: 15,
        memo: { text: '보정 설비', author: 'kim', authorName: '김철수', writtenAt: '2026-11-11 09:15', editedBy: null, editedAt: null } },
      { eqpId: 'E1', process: 'CVD', model: 'M1', fileName: N1, date: '2026-11-11', time: '09:13:02', daysLeft: 15,
        memo: { text: '알람 창이 가려짐', author: 'kim', authorName: '김철수', writtenAt: '2026-11-11 09:14', editedBy: null, editedAt: null } }
    ])
    expect(repo.calls[0]).toEqual(['findMemos', { eqpId: undefined, fromName: String(NOW - 15 * DAY), toName: undefined }, MEMO_LIST_LIMIT + 1])
  })
  it('스냅샷 시각이 15일을 넘은 메모는 싣지 않는다(쓴 때가 아니라 스냅샷 시각 — 결정)', async () => {
    const repo = fakeRepo([
      memoDoc({ filename: name(NOW - 15 * DAY - 1), snapshotTimestamp: new Date(NOW - 1000) }),
      memoDoc({ filename: name(NOW - 15 * DAY), memo: '경계', snapshotTimestamp: new Date(NOW - 40 * DAY) })
    ])
    expect((await service(repo).list(KIM)).items.map((i) => i.memo.text)).toEqual(['경계'])
  })
  it('숨김·틀린 문서·같은 키의 옛 문서는 싣지 않는다', async () => {
    const repo = fakeRepo([
      memoDoc({ hiddensnapshot: '1' }), memoDoc({ filename: name(T1 + 1), memo: 3 }),
      memoDoc({ filename: N2, memo: '먼저', snapshotTimestamp: new Date(T2) }), memoDoc({ filename: N2, memo: '나중', snapshotTimestamp: new Date(T2 + 1) })
    ])
    expect((await service(repo).list(KIM)).items.map((i) => i.memo.text)).toEqual(['나중'])
  })
  it('같은 파일 이름이라도 설비가 다르면 따로 싣는다', async () => {
    const repo = fakeRepo([memoDoc({ memo: 'E1 것' }), memoDoc({ eqpid: 'E2', memo: 'E2 것' })])
    expect((await service(repo).list(KIM)).items.map((i) => [i.eqpId, i.memo.text]).sort()).toEqual([['E1', 'E1 것'], ['E2', 'E2 것']])
  })
  it('쓴 때가 없는 메모는 맨 뒤, 같은 때면 설비 순', async () => {
    const repo = fakeRepo([
      memoDoc({ eqpid: 'E2', snapshotTimestamp: new Date(T1) }), memoDoc({ snapshotTimestamp: new Date(T1) }),
      memoDoc({ filename: N2, snapshotTimestamp: 'x' })
    ])
    expect((await service(repo).list(KIM)).items.map((i) => [i.eqpId, i.fileName])).toEqual([['E1', N1], ['E2', N1], ['E1', N2]])
  })
  it('한도를 넘으면 한도까지만 쓰고 truncated', async () => {
    const many = Array.from({ length: MEMO_LIST_LIMIT + 3 }, (_, i) => memoDoc({ filename: name(T1 + i) }))
    const r = await service(fakeRepo(many)).list(KIM)
    expect([r.items.length, r.truncated]).toEqual([MEMO_LIST_LIMIT, true])
    expect(MEMO_LIST_LIMIT).toBe(5000)
  })
  it('읽지 못하면 그 오류를 그대로 던진다(목록 창이 실패를 보인다)', async () => {
    const e = await caught(service(fakeRepo([], { fail: { findMemos: seError(503, 'UPSTREAM_DOWN', 'x') } })).list(KIM))
    expect(e.code).toBe('UPSTREAM_DOWN')
  })
})
