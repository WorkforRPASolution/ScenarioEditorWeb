// 스냅샷 받기 — 시작 때의 설비·날짜·고른 줄로 끝까지, 한도, 못 받은 것 목록, 취소 (P3 설계 §4.6, DC-037·DC-085)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn() }))
const side = vi.hoisted(() => ({ saveBlob: vi.fn(), drawCircle: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
vi.mock('../editor/snapshotDownload', async (importOriginal) => ({ ...(await importOriginal()), saveBlob: side.saveBlob, drawCircle: side.drawCircle }))
import { useSnapshotStore } from '../stores/snapshotStore'
import { useSnapshotDownloadStore } from '../stores/snapshotDownloadStore'
import { useEditorStore } from '../stores/editorStore'
import { t } from '../messages'
import { joinParts, unzip } from './helpers/unzip'

const ok = (data) => Promise.resolve({ data: { data } })
const defer = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const blobFail = (status, code) => ({ response: { status, data: new Blob([JSON.stringify({ success: false, code })], { type: 'application/json' }) } })
const click = (n, x = 1, y = 2) => ({ fileName: `${n}_[${x}][${y}].png`, ms: n, time: `09:00:0${n % 10}`, shift: 'DAY', kind: 'click', tag: null, x, y, txn: null, hasHistory: false, memo: null, daysLeft: 15 })
const ITEMS = [click(1000, 10, 20), click(2001, 30, 40), click(3002, 9500, 1), click(4003, 50, 60)]
const name = (i) => ITEMS[i].fileName
const DAYS = { latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }
const many = (n) => Array.from({ length: n }, (_, i) => click(100000 + i))
const textOf = async (blob) => new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))

describe('snapshotDownloadStore', () => {
  let items
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    Object.values(api).forEach((f) => f.mockReset())
    Object.values(side).forEach((f) => f.mockReset())
    items = ITEMS
    api.equipment.mockImplementation(() => ok({ items: [{ eqpId: 'A', process: 'P', model: 'M', line: 'L' }, { eqpId: 'B', process: 'P', model: 'M', line: 'L' }] }))
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS }))
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items, skipped: 0, truncated: false }))
    api.snapshotImage.mockImplementation((eqpId, fileName) => Promise.resolve({ data: new Blob([`${eqpId}:${fileName}`], { type: 'image/png' }) }))
    side.drawCircle.mockImplementation(async (blob, x, y) => new Blob([`circle(${x},${y}):${await textOf(blob)}`], { type: 'image/png' }))
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  const ready = async (pick = [0]) => {
    const s = useSnapshotStore()
    await s.pickEquipment('A', { select: false })
    s.select(items[pick[0]].fileName)
    for (const i of pick.slice(1)) s.togglePick(items[i].fileName)
    await flushPromises()
    api.snapshotImage.mockClear() // 큰 화면이 받은 것은 세지 않는다
    return { s, d: useSnapshotDownloadStore() }
  }
  const saved = () => side.saveBlob.mock.calls.map(([blob, fileName]) => ({ blob, fileName }))

  it('한 장을 고르면 PNG 그대로 저장하고, 끝나면 창 없이 알린다', async () => {
    const { s, d } = await ready([1])
    await d.start(false)
    expect(api.snapshotImage.mock.calls.map((c) => [c[0], c[1]])).toEqual([['A', name(1)]])
    expect(saved().map((x) => x.fileName)).toEqual(['A_2026-11-11_09-00-01-001.png'])
    expect(await textOf(saved()[0].blob)).toBe(`A:${name(1)}`)
    expect(d.job.status).toBe('idle')
    expect(s.notice).toBe(t('SEW_SNAP_DL_DONE', { n: 1 }))
  })

  it('여러 장은 목록 순서로 받아 ZIP 하나로 저장한다 — 좌표 포함이면 원 조건에 맞는 장에만 원', async () => {
    const { s, d } = await ready([3, 0, 2])
    await d.start(true)
    expect(api.snapshotImage.mock.calls.map((c) => c[1])).toEqual([name(0), name(2), name(3)])
    expect(saved()).toHaveLength(1)
    expect(saved()[0].fileName).toBe('A_2026-11-11_snapshots_xy_3.zip')
    const entries = unzip(await joinParts([saved()[0].blob]))
    expect(entries.map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual([
      ['A_2026-11-11_09-00-00-000_xy.png', `circle(10,20):A:${name(0)}`],
      ['A_2026-11-11_09-00-02-002.png', `A:${name(2)}`], // x ≥ 9000 — 원 없음
      ['A_2026-11-11_09-00-03-003_xy.png', `circle(50,60):A:${name(3)}`]
    ])
    expect(s.notice).toBe(t('SEW_SNAP_DL_DONE', { n: 3 }))
    expect(d.job.status).toBe('idle')
  })

  it('받는 동안 진행(n / 전체)이 오르고, 다시 시작하지 못한다', async () => {
    const { d } = await ready([0, 1, 3])
    const gates = [defer(), defer(), defer()]
    let k = 0
    api.snapshotImage.mockImplementation(() => gates[k++].promise)
    const run = d.start(false)
    await flushPromises()
    expect(d.job).toMatchObject({ status: 'running', done: 0, total: 3 })
    await d.start(false) // 무시된다
    expect(api.snapshotImage).toHaveBeenCalledTimes(1)
    gates[0].resolve({ data: new Blob(['a']) })
    await flushPromises()
    expect(d.job).toMatchObject({ status: 'running', done: 1, total: 3 })
    gates[1].resolve({ data: new Blob(['b']) })
    gates[2].resolve({ data: new Blob(['c']) })
    await run
    expect(d.job.status).toBe('idle')
    expect(saved()).toHaveLength(1)
  })

  it('받는 중에 설비·날짜·고른 줄을 바꿔도 시작 때의 것으로 끝까지 간다(DC-085)', async () => {
    const { s, d } = await ready([0, 1])
    const gate = defer()
    api.snapshotImage.mockImplementationOnce(() => gate.promise)
    const run = d.start(false)
    await flushPromises()
    await s.pickEquipment('B', { select: false }) // 다른 설비 — 고른 줄도 비워진다
    gate.resolve({ data: new Blob([`A:${name(0)}`]) })
    await run
    expect(api.snapshotImage.mock.calls.filter((c) => c[0] === 'A').map((c) => c[1])).toEqual([name(0), name(1)])
    expect(saved()[0].fileName).toBe('A_2026-11-11_snapshots_2.zip')
    expect(unzip(await joinParts([saved()[0].blob])).map((e) => e.name)).toEqual(['A_2026-11-11_09-00-00-000.png', 'A_2026-11-11_09-00-01-001.png'])
  })

  it('받지 못한 장은 건너뛰고 나머지를 저장한 뒤, 창에 못 받은 것과 이유를 남긴다(DC-037)', async () => {
    const { s, d } = await ready([0, 1, 3])
    api.snapshotImage.mockImplementation((eqpId, fileName) => (fileName === name(1) ? Promise.reject(blobFail(404, 'SNAPSHOT_NOT_FOUND')) : Promise.resolve({ data: new Blob(['ok']) })))
    await d.start(false)
    expect(saved()[0].fileName).toBe('A_2026-11-11_snapshots_2.zip')
    expect(d.job).toMatchObject({ status: 'done', done: 3, total: 3, saved: { name: 'A_2026-11-11_snapshots_2.zip', count: 2 } })
    expect(d.job.failed).toEqual([{ item: ITEMS[1], reason: t('SEW_ERR_SNAPSHOT_NOT_FOUND') }])
    expect(s.notice).toBe('')
    d.close()
    expect(d.job.status).toBe('idle')
  })

  it('원을 그리지 못한 장은 못 받은 것으로 — 이유를 알린다', async () => {
    const { d } = await ready([0, 1])
    side.drawCircle.mockImplementation(async (blob, x) => { if (x === 10) throw new Error('decode'); return blob })
    await d.start(true)
    expect(d.job.failed).toEqual([{ item: ITEMS[0], reason: t('SEW_SNAP_DL_CIRCLE_FAILED') }])
    expect(d.job.saved.count).toBe(1)
  })

  it('하나도 받지 못하면 저장하지 않고 창에 알린다', async () => {
    const { d } = await ready([0, 1])
    api.snapshotImage.mockImplementation(() => Promise.reject(blobFail(503, 'SNAPSHOT_DOWN')))
    await d.start(false)
    expect(side.saveBlob).not.toHaveBeenCalled()
    expect(d.job).toMatchObject({ status: 'done', saved: null })
    expect(d.job.failed.map((f) => f.reason)).toEqual([t('SEW_ERR_SNAPSHOT_DOWN'), t('SEW_ERR_SNAPSHOT_DOWN')])
  })

  it('취소하면 진행 중 요청을 끊고 아무것도 저장하지 않는다', async () => {
    const { s, d } = await ready([0, 1, 3])
    let signal = null
    api.snapshotImage.mockImplementationOnce(() => Promise.resolve({ data: new Blob(['a']) }))
    api.snapshotImage.mockImplementationOnce((eqpId, fileName, sig) => new Promise((resolve, reject) => { signal = sig; sig.addEventListener('abort', () => reject(new Error('canceled'))) }))
    const run = d.start(false)
    await flushPromises()
    expect(d.job).toMatchObject({ status: 'running', done: 1 })
    d.cancel()
    await run
    expect(signal.aborted).toBe(true)
    expect(api.snapshotImage).toHaveBeenCalledTimes(2)
    expect(side.saveBlob).not.toHaveBeenCalled()
    expect(d.job.status).toBe('idle')
    expect(s.notice).toBe(t('SEW_SNAP_DL_CANCELED'))
  })

  it('한 번에 100장까지 — 넘으면 시작하지 않고 알린다. 관리 등급 1 은 300장까지', async () => {
    items = many(301)
    const { s, d } = await ready([0])
    // 범위를 잡으면 큰 화면이 그 줄의 그림을 받는다 — 받기가 부른 것만 세게 비운다
    const range = async (i) => { s.pickRange(items[i].fileName); await flushPromises(); api.snapshotImage.mockClear() }
    await range(100) // 101장
    await d.start(false)
    expect(api.snapshotImage).not.toHaveBeenCalled()
    expect(d.job.status).toBe('idle')
    expect(s.notice).toBe(t('SEW_SNAP_DL_LIMIT', { max: 100, n: 101 }))
    await range(99) // 100장 — 한도 안
    await d.start(false)
    expect(api.snapshotImage).toHaveBeenCalledTimes(100)
    useEditorStore().me = { singleid: 'boss', authorityManager: 1 }
    await range(300) // 301장
    await d.start(false)
    expect(api.snapshotImage).not.toHaveBeenCalled()
    expect(s.notice).toBe(t('SEW_SNAP_DL_LIMIT', { max: 300, n: 301 }))
    await range(299) // 300장
    await d.start(false)
    expect(api.snapshotImage).toHaveBeenCalledTimes(300)
    expect(saved().at(-1).fileName).toBe('A_2026-11-11_snapshots_300.zip')
  })

  // 독립 검토 4: 묶거나 저장하다 던지면 창이 "받는 중" 에 멈춰 새로고침해야 했다
  it('묶거나 저장하다 실패해도 창이 받는 중에 멈추지 않는다 — 알리고 끝낸다', async () => {
    const { s, d } = await ready([0, 1])
    side.saveBlob.mockImplementation(() => { throw new Error('disk') })
    await d.start(false)
    expect(d.job.status).toBe('idle')
    expect(s.notice).toBe(t('SEW_SNAP_DL_FAILED'))
    side.saveBlob.mockReset()
    await d.start(false) // 다시 받을 수 있다
    expect(saved()).toHaveLength(1)
  })

  it('고른 것이 없으면 아무 일도 없다', async () => {
    const s = useSnapshotStore()
    await s.pickEquipment('A', { select: false })
    const d = useSnapshotDownloadStore()
    await d.start(false)
    expect(api.snapshotImage).not.toHaveBeenCalled()
    expect(d.job.status).toBe('idle')
  })
})
