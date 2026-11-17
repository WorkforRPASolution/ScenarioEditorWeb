// 새 스텝 메뉴 — 표 위 [새 스텝] 과 스냅샷 화면 [새 스텝] 이 함께 쓴다(2026-11-17 사내 요청).
// 화면마다 한 줄(지금 스냅샷·고른 스텝의 화면·그림 파일)이고 오른쪽에서 종류([이미지]·[OCR])를 누른다. 맨 아래는 조건 없는 스텝.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
const pick = vi.hoisted(() => ({ pickImageFile: vi.fn() }))
vi.mock('../editor/pickFile', () => pick)
import NewStepMenu from '../components/NewStepMenu.vue'
import { useSnapshotStore } from '../stores/snapshotStore'
import { useEditStore } from '../stores/editStore'
import { panelFixture, imageStep, noneStep } from './panelFixture'
import { MESSAGES, t } from '../messages'

enableAutoUnmount(afterEach)
const ok = (data) => Promise.resolve({ data: { data } })
const blobFail = (status, code) => ({ response: { status, data: new Blob([JSON.stringify({ success: false, code })], { type: 'application/json' }) } })
const click = (n, x, y, time = '09:13:02') => ({ fileName: `${n}_[${x}][${y}].png`, ms: n, time, shift: 'DAY', kind: 'click', tag: null, x, y, txn: null, hasHistory: false, memo: null, daysLeft: 15 })
const tag = (n, kind = 'start') => ({ fileName: `${n}_[9999][${n}].png`, ms: n, time: '10:00:00', shift: 'DAY', kind: 'tag', tag: kind, x: null, y: null, txn: String(n), hasHistory: true, memo: null, daysLeft: 15 })
const ITEMS = [click(10, 40, 50, '00:30:10'), click(11, 412, 288), tag(12)]
const name = (i) => ITEMS[i].fileName
const DAYS = { latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }
const tid = (w, id) => w.find(`[data-testid="${id}"]`)
const off = (b) => b.attributes('disabled') !== undefined
const row = (w, src) => w.find(`[data-src="${src}"]`)

describe('NewStepMenu', () => {
  let urls
  let blobs
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    Object.values(api).forEach((f) => f.mockReset())
    pick.pickImageFile.mockReset()
    api.equipment.mockImplementation(() => ok({ items: [{ eqpId: 'SEWT_A01', process: 'P', model: 'M', line: 'L' }] }))
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS }))
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: ITEMS, skipped: 0, truncated: false }))
    blobs = new Map()
    api.snapshotImage.mockImplementation((eqpId, fileName) => { const b = new Blob([fileName]); blobs.set(fileName, b); return Promise.resolve({ data: b }) })
    urls = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urls}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  // 시나리오(스텝 셋: 이미지·이미지·조건 없음)와 스냅샷 목록. i = 고를 스냅샷(없으면 고르지 않는다)
  const setup = async ({ snapshot = null, steps = [imageStep(0), imageStep(1), noneStep(2)], opts } = {}) => {
    const fx = panelFixture(steps, opts)
    const snap = useSnapshotStore()
    await snap.pickEquipment('SEWT_A01', { select: false })
    if (snapshot !== null) { snap.select(name(snapshot)); await flushPromises() }
    const w = mount(NewStepMenu, { attachTo: document.body })
    return { ...fx, snap, w }
  }

  it('화면마다 한 줄(지금 스냅샷·고른 스텝의 화면·그림 파일)과 조건 없는 스텝 — 줄마다 어느 화면인지 그림과 글로 보인다', async () => {
    const { s, w } = await setup({ snapshot: 1 })
    s.select('s1')
    await flushPromises()
    expect(w.findAll('[data-src]').map((r) => r.attributes('data-src'))).toEqual(['snapshot', 'step', 'file'])
    const sn = row(w, 'snapshot')
    expect(sn.attributes('data-off')).toBe('false')
    expect(sn.text()).toContain(MESSAGES.SEW_NEW_SRC_SNAPSHOT)
    expect(sn.text()).toContain('09:13:02')
    expect(sn.text()).toContain(t('SEW_SNAP_INFO_CLICK', { x: 412, y: 288 }))
    expect(sn.find('img').attributes('src')).toBe(useSnapshotStore().image.url)
    const st = row(w, 'step')
    expect(st.attributes('data-off')).toBe('false')
    expect(st.text()).toContain(t('SEW_NEW_SRC_STEP', { no: 2 }))
    expect(st.text()).toContain('스텝1')
    expect(st.find('img').attributes('src')).toContain('s1-bi')
    const fl = row(w, 'file')
    expect(fl.text()).toContain(MESSAGES.SEW_NEW_SRC_FILE)
    expect(fl.text()).toContain(MESSAGES.SEW_NEW_SRC_FILE_SUB)
    for (const id of ['snapshot-image', 'snapshot-ocr', 'step-image', 'step-ocr', 'file-image', 'file-ocr', 'none']) expect(off(tid(w, `se-new-${id}`))).toBe(false)
    expect(tid(w, 'se-new-snapshot-image').attributes('role')).toBe('menuitem')
    expect(tid(w, 'se-new-snapshot-image').attributes('aria-label')).toBe(`${MESSAGES.SEW_NEW_SRC_SNAPSHOT} — ${MESSAGES.SEW_EDIT_NEW_IMAGE}`)
    expect(tid(w, 'se-new-file-ocr').attributes('aria-label')).toBe(`${MESSAGES.SEW_NEW_SRC_FILE} — ${MESSAGES.SEW_EDIT_NEW_OCR}`)
    expect(tid(w, 'se-new-none').text()).toContain(MESSAGES.SEW_EDIT_NEW_NONE)
    expect(tid(w, 'se-new-none').text()).toContain(MESSAGES.SEW_EDIT_NEW_NONE_HINT)
  })
  it('태그 스냅샷은 태그 이름을 보인다', async () => {
    const { w } = await setup({ snapshot: 2 })
    expect(row(w, 'snapshot').text()).toContain('10:00:00')
    expect(row(w, 'snapshot').text()).toContain(MESSAGES.SEW_SNAP_TAG_start)
  })
  it('스냅샷을 고르지 않았으면 스냅샷 줄이 꺼지고 까닭이 그 줄에 적힌다 — 그림 파일·조건 없는 스텝은 켜져 있다', async () => {
    const { w, snap } = await setup()
    expect(row(w, 'snapshot').attributes('data-off')).toBe('true')
    expect(row(w, 'snapshot').text()).toContain(MESSAGES.SEW_NEW_SRC_SNAPSHOT_PICK)
    expect(row(w, 'snapshot').find('img').exists()).toBe(false)
    expect([off(tid(w, 'se-new-snapshot-image')), off(tid(w, 'se-new-snapshot-ocr')), off(tid(w, 'se-new-file-image')), off(tid(w, 'se-new-none'))]).toEqual([true, true, false, false])
    // 골랐지만 그림을 받지 못했다
    api.snapshotImage.mockImplementation(() => Promise.reject(blobFail(404, 'SNAPSHOT_NOT_FOUND')))
    snap.select(name(0))
    await flushPromises()
    expect(row(w, 'snapshot').attributes('data-off')).toBe('true')
    expect(row(w, 'snapshot').text()).toContain(MESSAGES.SEW_NEW_SRC_SNAPSHOT_NO_IMAGE)
    expect(off(tid(w, 'se-new-snapshot-image'))).toBe(true)
  })
  it('받은 스냅샷을 브라우저가 그림으로 읽지 못하면(작은 그림 오류) 스냅샷 줄을 끈다', async () => {
    const { w } = await setup({ snapshot: 1 })
    expect(off(tid(w, 'se-new-snapshot-image'))).toBe(false)
    await row(w, 'snapshot').find('img').trigger('error')
    expect(row(w, 'snapshot').attributes('data-off')).toBe('true')
    expect(row(w, 'snapshot').text()).toContain(MESSAGES.SEW_NEW_SRC_SNAPSHOT_NO_IMAGE)
    expect(off(tid(w, 'se-new-snapshot-ocr'))).toBe(true)
  })
  it('고른 줄이 없거나 고른 스텝에 기준 화면이 없으면 스텝 줄이 꺼지고 까닭이 적힌다', async () => {
    const { s, e, w } = await setup()
    e.setSelection({ uids: [], anchor: null })
    await flushPromises()
    expect(row(w, 'step').attributes('data-off')).toBe('true')
    expect(row(w, 'step').text()).toContain(MESSAGES.SEW_NEW_SRC_STEP_ANY)
    expect(row(w, 'step').text()).toContain(MESSAGES.SEW_NEW_SRC_STEP_PICK)
    expect([off(tid(w, 'se-new-step-image')), off(tid(w, 'se-new-step-ocr'))]).toEqual([true, true])
    s.select('s2') // 조건 없는 스텝
    await flushPromises()
    expect(row(w, 'step').attributes('data-off')).toBe('true')
    expect(row(w, 'step').text()).toContain(t('SEW_NEW_SRC_STEP', { no: 3 }))
    expect(row(w, 'step').text()).toContain(MESSAGES.SEW_NEW_SRC_STEP_NO_BASE)
    expect(row(w, 'step').find('img').exists()).toBe(false)
    s.select('s0')
    await flushPromises()
    expect(row(w, 'step').attributes('data-off')).toBe('false')
    expect(off(tid(w, 'se-new-step-image'))).toBe(false)
  })
  it('스텝이 없는 시나리오에서도 스냅샷·그림 파일·조건 없는 스텝은 켜져 있다', async () => {
    const { w } = await setup({ snapshot: 0, steps: [] })
    expect([off(tid(w, 'se-new-snapshot-image')), off(tid(w, 'se-new-step-image')), off(tid(w, 'se-new-file-ocr')), off(tid(w, 'se-new-none'))]).toEqual([false, true, false, false])
  })
  it('[이미지]·[OCR] 을 누르면 그 줄의 화면으로 새 스텝을 시작하고 done 을 알린다', async () => {
    const { w } = await setup({ snapshot: 1 })
    const startNew = vi.spyOn(useEditStore(), 'startNew').mockReturnValue(true)
    await tid(w, 'se-new-snapshot-image').trigger('click')
    expect(startNew.mock.calls[0][0]).toBe('image')
    expect(startNew.mock.calls[0][1]).toEqual({ snapshot: { eqpId: 'SEWT_A01', fileName: name(1), blob: blobs.get(name(1)) } })
    expect(startNew.mock.calls[0][1].snapshot.blob).toBe(blobs.get(name(1))) // 화면이 그리는 그 바이트
    await tid(w, 'se-new-step-ocr').trigger('click')
    expect(startNew.mock.calls[1]).toEqual(['ocr'])
    await tid(w, 'se-new-none').trigger('click')
    expect(startNew.mock.calls[2]).toEqual(['none'])
    expect(w.emitted('done')).toHaveLength(3)
    expect(pick.pickImageFile).not.toHaveBeenCalled()
  })
  it('그림 파일 줄: 파일 고르기 창을 열고, 고른 파일로 새 스텝을 시작한다 — 고르지 않으면 아무것도 하지 않는다', async () => {
    const { w } = await setup()
    const e = useEditStore()
    const startNew = vi.spyOn(e, 'startNew').mockReturnValue(true)
    const fromFile = vi.spyOn(e, 'startNewFromFile').mockResolvedValue(true)
    const file = new File(['x'], 'screen.png', { type: 'image/png' })
    pick.pickImageFile.mockResolvedValueOnce(file)
    await tid(w, 'se-new-file-ocr').trigger('click')
    expect(w.emitted('done')).toHaveLength(1) // 메뉴는 바로 닫는다
    await flushPromises()
    expect(fromFile.mock.calls).toEqual([['ocr', file]])
    pick.pickImageFile.mockResolvedValueOnce(null) // 창에서 취소
    await tid(w, 'se-new-file-image').trigger('click')
    await flushPromises()
    expect(fromFile).toHaveBeenCalledTimes(1)
    expect(startNew).not.toHaveBeenCalled()
  })
})
