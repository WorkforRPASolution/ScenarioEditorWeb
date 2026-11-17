// 큰 화면 스냅샷 모드 — 그림·클릭 점·정보 줄·이동·확대 (P3 설계 §4.3)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn(), history: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import SnapshotViewer from '../components/snapshot/SnapshotViewer.vue'
import { useSnapshotStore } from '../stores/snapshotStore'
import { useEditorStore } from '../stores/editorStore'
import { useSnapshotDownloadStore } from '../stores/snapshotDownloadStore'
import { useEditStore } from '../stores/editStore'
import { panelFixture, imageStep } from './panelFixture'
import { MESSAGES } from '../messages'

enableAutoUnmount(afterEach)
const ok = (data) => Promise.resolve({ data: { data } })
const defer = () => { let resolve; const promise = new Promise((res) => { resolve = res }); return { promise, resolve } }
const blobFail = (status, code) => ({ response: { status, data: new Blob([JSON.stringify({ success: false, code })], { type: 'application/json' }) } })
const click = (n, x, y, time = '09:13:02') => ({ fileName: `${n}_[${x}][${y}].png`, ms: n, time, shift: 'DAY', kind: 'click', tag: null, x, y, txn: null, hasHistory: false, memo: null, daysLeft: 15 })
const tag = (n, kind = 'start') => ({ fileName: `${n}_[9999][${n}].png`, ms: n, time: '10:00:00', shift: 'DAY', kind: 'tag', tag: kind, x: null, y: null, txn: String(n), hasHistory: true, memo: null, daysLeft: 15 })
// 0 클릭(그림 안) · 1 클릭(412, 288) · 2 태그 · 3 클릭(그림 밖) · 4 클릭
const ITEMS = [click(10, 40, 50, '00:30:10'), click(11, 412, 288), tag(12), click(13, 900, 20), click(14, 5, 5)]
const name = (i) => ITEMS[i].fileName
const DAYS = { latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }
const IMG = { target: { naturalWidth: 640, naturalHeight: 360 } }
const tid = (w, id) => w.find(`[data-testid="${id}"]`)

describe('SnapshotViewer', () => {
  let observers
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
    observe() {}
    unobserve() {}
  }
  let urls
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    observers = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.values(api).forEach((f) => f.mockReset())
    api.equipment.mockImplementation(() => ok({ items: [{ eqpId: 'SEWT_A01', process: 'P', model: 'M', line: 'L' }] }))
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS }))
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: ITEMS, skipped: 0, truncated: false }))
    api.snapshotImage.mockImplementation(() => Promise.resolve({ data: new Blob(['x']) }))
    urls = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urls}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const ready = async () => {
    const s = useSnapshotStore()
    await s.pickEquipment('SEWT_A01', { select: false })
    return s
  }
  // happy-dom 은 레이아웃이 없다 — 상자 크기를 직접 정하고 크기 관찰을 깨운다
  const mountSized = async (cw = 800, ch = 400) => {
    const s = await ready()
    const w = mount(SnapshotViewer, { attachTo: document.body })
    const el = w.find('.select-none').element
    Object.defineProperty(el, 'clientWidth', { get: () => cw, configurable: true })
    Object.defineProperty(el, 'clientHeight', { get: () => ch, configurable: true })
    observers.forEach((o) => o.cb([]))
    return { w, s }
  }
  const show = async (w, s, i) => { s.select(name(i)); await flushPromises(); w.vm.onLoad(IMG); await w.vm.$nextTick() }
  const tf = (w) => {
    const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(tid(w, 'se-snap-image').element.parentElement.style.transform)
    return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) }
  }

  describe('그림과 상태', () => {
    it('고른 것이 없으면 안내 — 패널이 접혀 있으면 펼치라는 안내', async () => {
      const { w, s } = await mountSized()
      expect(tid(w, 'se-snap-empty').text()).toBe(MESSAGES.SEW_SNAP_VIEW_NO_PANEL)
      await s.setOpen(true)
      await flushPromises()
      expect(tid(w, 'se-snap-empty').text()).toBe(MESSAGES.SEW_SNAP_VIEW_EMPTY)
      expect(tid(w, 'se-snap-image').exists()).toBe(false)
      expect(tid(w, 'se-snap-info').exists()).toBe(false)
    })
    it('받는 동안에는 받는 중 표시이고 그림이 없다, 받으면 그 그림을 띄운다', async () => {
      const { w, s } = await mountSized()
      const gate = defer()
      api.snapshotImage.mockImplementationOnce(() => gate.promise)
      s.select(name(1))
      await w.vm.$nextTick()
      expect(tid(w, 'se-snap-loading').text()).toBe(MESSAGES.SEW_SNAP_VIEW_LOADING)
      expect(tid(w, 'se-snap-image').exists()).toBe(false)
      gate.resolve({ data: new Blob(['x']) })
      await flushPromises()
      expect(tid(w, 'se-snap-loading').exists()).toBe(false)
      expect(tid(w, 'se-snap-image').attributes('src')).toBe(s.image.url)
    })
    it('정보 줄: 설비·날짜·시각·근무조·클릭 좌표·그림 크기(불러온 뒤)·목록 안 순번', async () => {
      const { w, s } = await mountSized()
      s.select(name(1))
      await flushPromises()
      const info = () => tid(w, 'se-snap-info').text()
      for (const part of ['SEWT_A01', '2026-11-11', '09:13:02', 'DAY', '클릭 (412, 288)', '2 / 5']) expect(info()).toContain(part)
      expect(info()).not.toContain('640 × 360')
      w.vm.onLoad(IMG); await w.vm.$nextTick()
      expect(info()).toContain('640 × 360')
    })
    it('여러 날을 보고 있으면 정보 줄의 날짜는 그 스냅샷의 날짜다(범위의 첫 날이 아니다)', async () => {
      const dated = ITEMS.map((it, i) => ({ ...it, date: i < 2 ? '2026-11-09' : '2026-11-10' }))
      api.snapshots.mockImplementation((eqpId, date, to) => ok({ eqpId, date, ...(to ? { to } : {}), timeDiff: 0, items: dated, skipped: 0, truncated: false }))
      const { w, s } = await mountSized()
      await s.setDates('2026-11-09', '2026-11-10')
      s.select(name(3))
      await flushPromises()
      expect(tid(w, 'se-snap-info').text()).toContain('2026-11-10')
      expect(tid(w, 'se-snap-info').text()).not.toContain('2026-11-09')
    })
    it('태그 스냅샷은 좌표 대신 태그 알약, 순번은 거른 목록 안에서 센다', async () => {
      const { w, s } = await mountSized()
      s.setFilter('tag')
      await show(w, s, 2)
      const info = tid(w, 'se-snap-info')
      expect(info.find('[data-testid="se-snap-tag"]').text()).toBe('시작')
      expect(info.text()).not.toContain('클릭')
      expect(info.text()).toContain('1 / 1')
    })
    it('그림을 받지 못하면 그림을 비우고 이유를 보인다 — 없음·응답 없음이 다른 글', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 0)
      expect(tid(w, 'se-snap-image').exists()).toBe(true)
      api.snapshotImage.mockImplementation((eqpId, fileName) => Promise.reject(blobFail(fileName === name(3) ? 404 : 503, fileName === name(3) ? 'SNAPSHOT_NOT_FOUND' : 'SNAPSHOT_DOWN')))
      s.select(name(3))
      await flushPromises()
      expect(tid(w, 'se-snap-image').exists()).toBe(false)
      expect(tid(w, 'se-snap-dot').exists()).toBe(false)
      expect(tid(w, 'se-snap-error').text()).toBe(MESSAGES.SEW_ERR_SNAPSHOT_NOT_FOUND)
      s.select(name(4))
      await flushPromises()
      expect(tid(w, 'se-snap-error').text()).toBe(MESSAGES.SEW_ERR_SNAPSHOT_DOWN)
      // 정보 줄·이동은 그대로다
      expect(tid(w, 'se-snap-info').text()).toContain('5 / 5')
    })
    it('받았는데 브라우저가 그림으로 읽지 못하면 공통 문구', async () => {
      const { w, s } = await mountSized()
      s.select(name(1))
      await flushPromises()
      await tid(w, 'se-snap-image').trigger('error')
      expect(tid(w, 'se-snap-image').exists()).toBe(false)
      expect(tid(w, 'se-snap-error').text()).toBe(MESSAGES.SEW_SNAP_IMAGE_FAILED)
      s.select(name(0)) // 다른 그림을 고르면 다시 띄운다
      await flushPromises()
      expect(tid(w, 'se-snap-image').exists()).toBe(true)
    })
  })

  describe('클릭 점', () => {
    it('클릭 스냅샷이고 그림을 불러온 뒤에만, 그림 좌표 자리에 그린다', async () => {
      const { w, s } = await mountSized()
      s.select(name(1))
      await flushPromises()
      expect(tid(w, 'se-snap-dot').exists()).toBe(false) // 그림 크기를 아직 모른다
      w.vm.onLoad(IMG); await w.vm.$nextTick()
      const style = tid(w, 'se-snap-dot').attributes('style')
      expect(style).toContain('left: 412px')
      expect(style).toContain('top: 288px')
      // 점에서 고리가 퍼져 나간다(사내 요청 — 스타일은 snapshot.css 의 .se-snap-dot, E2E 가 움직임을 본다)
      expect(tid(w, 'se-snap-dot').classes()).toContain('se-snap-dot')
    })
    it('점은 확대해도 화면에서 같은 크기(지름 12px)다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 1)
      const size = () => Number(/width: ([\d.]+)px/.exec(tid(w, 'se-snap-dot').attributes('style'))[1])
      expect(size() * tf(w).scale).toBeCloseTo(12, 5)
      await tid(w, 'se-snap-zoom-actual').trigger('click')
      expect(size()).toBeCloseTo(12, 5)
    })
    it('태그 스냅샷과 그림 밖 좌표에는 그리지 않는다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 2)
      expect(tid(w, 'se-snap-dot').exists()).toBe(false)
      await show(w, s, 3) // (900, 20) — 640×360 밖
      expect(tid(w, 'se-snap-dot').exists()).toBe(false)
    })
    it('이미 고른 줄을 다시 골라도(같은 줄 누름·끝에서 End·하나뿐인 태그로 이동) 점·그림 크기가 남고 [1:1] 이 듣는다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 1)
      const img = tid(w, 'se-snap-image').element
      s.select(name(1))
      await flushPromises()
      expect(tid(w, 'se-snap-image').element).toBe(img) // 같은 그림 요소 — 다시 불러오지 않는다
      expect(tid(w, 'se-snap-dot').exists()).toBe(true)
      expect(tid(w, 'se-snap-info').text()).toContain('640 × 360')
      await tid(w, 'se-snap-zoom-actual').trigger('click')
      expect(tf(w).scale).toBe(1)
      s.moveTag(1) // 2 로 간다
      await flushPromises()
      w.vm.onLoad(IMG); await w.vm.$nextTick()
      s.moveTag(1) // 태그가 하나뿐 — 같은 줄
      await flushPromises()
      expect(tid(w, 'se-snap-info').text()).toContain('640 × 360')
    })
    it('다른 스냅샷을 고르면 새 그림이 불러와질 때까지 점이 없다 — 앞 그림의 크기로 그리지 않는다(DC-034)', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 1)
      expect(tid(w, 'se-snap-dot').exists()).toBe(true)
      s.select(name(0))
      await flushPromises()
      expect(tid(w, 'se-snap-dot').exists()).toBe(false)
      expect(tid(w, 'se-snap-info').text()).not.toContain('640 × 360')
      w.vm.onLoad(IMG); await w.vm.$nextTick()
      expect(tid(w, 'se-snap-dot').attributes('style')).toContain('left: 40px')
    })
  })

  describe('이동', () => {
    it('[이전]·[다음] 은 보이는 목록 안에서 옮기고 양 끝에서 꺼진다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 0)
      expect(tid(w, 'se-snap-prev').attributes('disabled')).toBeDefined()
      await tid(w, 'se-snap-next').trigger('click')
      expect(s.selectedName).toBe(name(1))
      await flushPromises()
      expect(tid(w, 'se-snap-prev').attributes('disabled')).toBeUndefined()
      await tid(w, 'se-snap-prev').trigger('click')
      expect(s.selectedName).toBe(name(0))
      s.select(name(4))
      await flushPromises()
      expect(tid(w, 'se-snap-next').attributes('disabled')).toBeDefined()
    })
    it('[◀ 태그]·[태그 ▶] 는 그 날의 태그로 간다. 없으면 알림 줄에 알린다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 0)
      await tid(w, 'se-snap-tag-next').trigger('click')
      expect(s.selectedName).toBe(name(2))
      await tid(w, 'se-snap-tag-prev').trigger('click')
      expect(s.selectedName).toBe(name(2)) // 태그가 하나뿐이면 그 자리
      expect(tid(w, 'se-snap-notice').exists()).toBe(false)
      api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: [ITEMS[0], ITEMS[1]], skipped: 0, truncated: false }))
      await s.setDate('2026-11-10')
      await tid(w, 'se-snap-tag-next').trigger('click')
      expect(tid(w, 'se-snap-notice').text()).toBe(MESSAGES.SEW_SNAP_NO_TAG)
    })
    it('목록이 비어 있으면 이동 버튼이 모두 꺼진다', async () => {
      const s = useSnapshotStore()
      const w = mount(SnapshotViewer)
      for (const id of ['se-snap-prev', 'se-snap-next', 'se-snap-tag-prev', 'se-snap-tag-next', 'se-snap-memo-prev', 'se-snap-memo-next']) expect(tid(w, id).attributes('disabled'), id).toBeDefined()
      expect(s.selectedName).toBeNull()
    })
  })

  describe('메모 줄·메모 이동 (P3-C)', () => {
    const memo = (text, author = 'kim', authorName = '김철수', more = {}) => ({ text, author, authorName, writtenAt: '2026-11-11 09:14', editedBy: null, editedAt: null, ...more })
    // 0 메모 없음 · 1 내 메모 · 2 태그 · 3 남의 메모(웹에서 고침) · 4 메모 없음
    const WITH = ITEMS.map((it, i) => (i === 1 ? { ...it, memo: memo('내 메모') } : i === 3 ? { ...it, memo: memo('남의 메모', 'lee', '이영희', { editedBy: 'park', editedAt: '2026-11-11 10:02' }) } : it))
    const body = () => new DOMWrapper(document.body)
    const mountMemo = async () => {
      api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: WITH, skipped: 0, truncated: false }))
      useEditorStore().me = { singleid: 'kim' }
      return mountSized()
    }

    it('고른 스냅샷이 없으면 메모 줄이 없다. 메모가 없으면 [메모 쓰기] 만', async () => {
      const { w, s } = await mountMemo()
      expect(tid(w, 'se-snap-memo').exists()).toBe(false)
      await show(w, s, 0)
      expect(tid(w, 'se-snap-memo-write').exists()).toBe(true)
      expect(tid(w, 'se-snap-memo-text').exists()).toBe(false)
      expect(tid(w, 'se-snap-memo-edit').exists()).toBe(false)
    })
    it('메모가 있으면 글과 작성자 이름, [고치기]·[지우기] — 쓴 때와 고친 사람은 도움말에', async () => {
      const { w, s } = await mountMemo()
      await show(w, s, 1)
      expect(tid(w, 'se-snap-memo-text').text()).toBe('내 메모')
      expect(tid(w, 'se-snap-memo-author').text()).toBe('— 김철수')
      expect(tid(w, 'se-snap-memo-author').attributes('title')).toBe('김철수 · 2026-11-11 09:14')
      expect(tid(w, 'se-snap-memo-write').exists()).toBe(false)
      expect(tid(w, 'se-snap-memo-edit').exists()).toBe(true)
      expect(tid(w, 'se-snap-memo-remove').exists()).toBe(true)
      await show(w, s, 3)
      expect(tid(w, 'se-snap-memo-author').text()).toBe('— 이영희')
      expect(tid(w, 'se-snap-memo-author').attributes('title')).toBe('이영희 · 2026-11-11 09:14 (고침: park 2026-11-11 10:02)')
    })
    it('[메모 쓰기]·[고치기] 는 메모 창을, [지우기] 는 지울지 묻는 창을 연다 — 내 아이디를 넘겨 남의 메모를 가린다', async () => {
      const { w, s } = await mountMemo()
      await show(w, s, 0)
      await tid(w, 'se-snap-memo-write').trigger('click')
      expect(body().find('[data-testid="se-memo-input"]').element.value).toBe('')
      await body().find('[data-testid="se-memo-cancel"]').trigger('click')
      expect(body().find('[data-testid="se-memo-dialog"]').exists()).toBe(false)
      await show(w, s, 1)
      await tid(w, 'se-snap-memo-edit').trigger('click')
      expect(body().find('[data-testid="se-memo-input"]').element.value).toBe('내 메모')
      expect(body().find('[data-testid="se-memo-others"]').exists()).toBe(false) // 내 메모
      await body().find('[data-testid="se-memo-cancel"]').trigger('click')
      await show(w, s, 3)
      await tid(w, 'se-snap-memo-remove').trigger('click')
      expect(body().find('[data-testid="se-memo-confirm"]').text()).toContain('남의 메모')
      expect(body().find('[data-testid="se-memo-others"]').text()).toBe('이영희 님이 쓴 메모입니다.')
    })
    it('[◀ 메모]·[메모 ▶] 는 그 날의 메모가 있는 스냅샷으로 간다(끝에서 돌아감). 없으면 알림 줄에 알린다', async () => {
      const { w, s } = await mountMemo()
      await show(w, s, 0)
      await tid(w, 'se-snap-memo-next').trigger('click')
      expect(s.selectedName).toBe(name(1))
      await tid(w, 'se-snap-memo-next').trigger('click')
      expect(s.selectedName).toBe(name(3))
      await tid(w, 'se-snap-memo-next').trigger('click')
      expect(s.selectedName).toBe(name(1))
      await tid(w, 'se-snap-memo-prev').trigger('click')
      expect(s.selectedName).toBe(name(3))
      api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: ITEMS, skipped: 0, truncated: false }))
      await s.setDate('2026-11-10')
      await tid(w, 'se-snap-memo-next').trigger('click')
      expect(tid(w, 'se-snap-notice').text()).toBe(MESSAGES.SEW_SNAP_NO_MEMO)
    })
  })

  describe('받기 (P3-D)', () => {
    it('고른 것이 없으면 [받기] 가 꺼져 있다. 하나면 "받기", 여러 줄이면 "받기 (n)"', async () => {
      const { w, s } = await mountSized()
      expect(tid(w, 'se-snap-download').attributes('disabled')).toBeDefined()
      await show(w, s, 1)
      expect(tid(w, 'se-snap-download').attributes('disabled')).toBeUndefined()
      expect(tid(w, 'se-snap-download').text()).toBe(`${MESSAGES.SEW_SNAP_DL} ▾`)
      s.pickRange(name(3))
      await flushPromises()
      expect(tid(w, 'se-snap-download').text()).toBe(`${MESSAGES.SEW_SNAP_DL_N.replace('{n}', '3')} ▾`)
    })
    it('[받기 ▾] 를 누르면 그림만·좌표 포함이 열리고, 고르면 닫히며 그 방식으로 받기를 시작한다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 1)
      const d = useSnapshotDownloadStore()
      const start = vi.spyOn(d, 'start').mockResolvedValue()
      expect(tid(w, 'se-snap-download-plain').exists()).toBe(false)
      await tid(w, 'se-snap-download').trigger('click')
      expect(tid(w, 'se-snap-download').attributes('aria-expanded')).toBe('true')
      await tid(w, 'se-snap-download-xy').trigger('click')
      expect(start).toHaveBeenLastCalledWith(true)
      expect(tid(w, 'se-snap-download-xy').exists()).toBe(false)
      await tid(w, 'se-snap-download').trigger('click')
      await tid(w, 'se-snap-download-plain').trigger('click')
      expect(start).toHaveBeenLastCalledWith(false)
    })
    it('메뉴는 Esc 나 바깥을 누르면 닫힌다. 받는 중에는 [받기] 가 꺼진다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 1)
      await tid(w, 'se-snap-download').trigger('click')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await w.vm.$nextTick()
      expect(tid(w, 'se-snap-download-plain').exists()).toBe(false)
      await tid(w, 'se-snap-download').trigger('click')
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await w.vm.$nextTick()
      expect(tid(w, 'se-snap-download-plain').exists()).toBe(false)
      useSnapshotDownloadStore().job = { status: 'running', done: 0, total: 1, failed: [], saved: null }
      await w.vm.$nextTick()
      expect(tid(w, 'se-snap-download').attributes('disabled')).toBeDefined()
    })
  })

  describe('이력 보기 (P3-D)', () => {
    it('이력이 남는 태그 스냅샷에서만 켜진다 — 꺼져 있을 때는 이유를 도움말로', async () => {
      api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: [ITEMS[0], ITEMS[2], { ...tag(15, 'success'), txn: '5', hasHistory: false }], skipped: 0, truncated: false }))
      const { w, s } = await mountSized()
      expect(tid(w, 'se-snap-history').attributes('disabled')).toBeDefined()
      await show(w, s, 0) // 클릭 스냅샷
      expect(tid(w, 'se-snap-history').attributes('disabled')).toBeDefined()
      expect(tid(w, 'se-snap-history').attributes('title')).toBe(MESSAGES.SEW_SNAP_HISTORY_ONLY_TAG)
      await show(w, s, 2) // 태그, txn ≥ 99999
      expect(tid(w, 'se-snap-history').attributes('disabled')).toBeUndefined()
      s.select(`15_[9999][15].png`) // 태그지만 이력 대상이 아니다
      await flushPromises()
      expect(tid(w, 'se-snap-history').attributes('disabled')).toBeDefined()
      expect(tid(w, 'se-snap-history').attributes('title')).toBe(MESSAGES.SEW_SNAP_HISTORY_NO_TXN)
    })
    it('누르면 그 설비·txn·태그로 이력 창을 연다', async () => {
      api.history.mockImplementation((eqpId, txn) => ok({ eqpId, txn, steps: [{ no: 1, text: '확인', images: [] }] }))
      const { w, s } = await mountSized()
      await show(w, s, 2)
      await tid(w, 'se-snap-history').trigger('click')
      await flushPromises()
      expect(api.history.mock.calls).toEqual([['SEWT_A01', '12']])
      const dialog = new DOMWrapper(document.body).find('[data-testid="se-history-dialog"]')
      expect(dialog.exists()).toBe(true)
      expect(dialog.find('[data-testid="se-history-head"]').text()).toContain('SEWT_A01')
      expect(dialog.findAll('[data-testid="se-history-step"]')).toHaveLength(1)
    })
  })

  describe('확대·이동(스텝 그림과 같은 usePanZoom)', () => {
    it('그림이 불러와지면 상자에 맞추고, [1:1]·[맞춤]·＋/－·휠·끌기가 듣는다', async () => {
      const { w, s } = await mountSized(800, 400)
      await show(w, s, 1)
      const fitted = tf(w)
      expect(fitted.scale).toBeCloseTo(Math.min(800 / 640, 400 / 360) * 0.98, 5)
      await tid(w, 'se-snap-zoom-actual').trigger('click')
      expect(tf(w).scale).toBe(1)
      await tid(w, 'se-snap-zoom-in').trigger('click')
      expect(tf(w).scale).toBeCloseTo(1.25, 5)
      await tid(w, 'se-snap-zoom-out').trigger('click')
      expect(tf(w).scale).toBeCloseTo(1, 5)
      await w.find('.select-none').trigger('wheel', { deltaY: -100, clientX: 10, clientY: 10 })
      expect(tf(w).scale).toBeCloseTo(1.15, 5)
      const before = tf(w)
      await w.find('.select-none').trigger('mousedown', { button: 0, clientX: 10, clientY: 10 })
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 30 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
      await w.vm.$nextTick()
      expect(tf(w).tx).toBeCloseTo(before.tx + 30, 5)
      await tid(w, 'se-snap-zoom-fit').trigger('click')
      expect(tf(w).scale).toBeCloseTo(fitted.scale, 5)
    })
    it('다음 그림이 불러와지면 다시 맞춘다', async () => {
      const { w, s } = await mountSized(800, 400)
      await show(w, s, 1)
      await tid(w, 'se-snap-zoom-actual').trigger('click')
      s.select(name(0))
      await flushPromises()
      w.vm.onLoad({ target: { naturalWidth: 1920, naturalHeight: 1080 } }); await w.vm.$nextTick()
      expect(tf(w).scale).toBeCloseTo(Math.min(800 / 1920, 400 / 1080) * 0.98, 5)
    })
  })

  it('머리 줄의 탭으로 스텝 그림에 갔다 올 수 있다', async () => {
    const { w, s } = await mountSized()
    await show(w, s, 1)
    expect(tid(w, 'se-mode-snapshot').attributes('aria-pressed')).toBe('true')
    await tid(w, 'se-mode-step').trigger('click')
    expect(s.mode).toBe('step')
    expect(s.selectedName).toBe(name(1))
    await tid(w, 'se-mode-snapshot').trigger('click')
    expect(s.mode).toBe('snapshot')
  })

  describe('새 스텝 (P3-E 스냅샷에서 스텝 만들기)', () => {
    const btn = (w) => tid(w, 'se-snap-new')
    const off = (w) => btn(w).attributes('disabled') !== undefined
    it('시나리오를 열지 않았으면 그림이 떠 있어도 꺼져 있고 까닭을 알린다', async () => {
      const { w, s } = await mountSized()
      await show(w, s, 1)
      expect(off(w)).toBe(true)
      expect(btn(w).attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_NO_SCENARIO)
    })
    it('읽기 전용으로 연 시나리오(옛 버전)에서는 꺼져 있다', async () => {
      const { w, s } = await mountSized()
      panelFixture([imageStep(0)], { isCurrent: false })
      await show(w, s, 1)
      expect(off(w)).toBe(true)
      expect(btn(w).attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_READ_ONLY)
    })
    it('쓰기 권한이 없으면 시나리오를 열었든 아니든 권한이 없다고 알린다 — "열면 만들 수 있다" 고 하지 않는다', async () => {
      const { w, s } = await mountSized()
      useEditorStore().me = { singleid: 'u', canWrite: false }
      await show(w, s, 1)
      expect(off(w)).toBe(true)
      expect(btn(w).attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_NO_WRITE)
      panelFixture([imageStep(0)], { canWrite: false })
      await w.vm.$nextTick()
      expect(off(w)).toBe(true)
      expect(btn(w).attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_NO_WRITE)
    })
    it('지워진 시나리오에서는 지워졌다고 알린다', async () => {
      const { w, s } = await mountSized()
      const { e } = panelFixture([imageStep(0)])
      await show(w, s, 1)
      expect(off(w)).toBe(false)
      e.markDeleted()
      await w.vm.$nextTick()
      expect(off(w)).toBe(true)
      expect(btn(w).attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_DELETED)
    })
    it('고칠 수 있는 시나리오여도 그림이 떠 있지 않으면(고른 줄 없음·받는 중·그려지기 전·실패) 이미지·OCR 스텝은 꺼져 있다(DC-038) — 조건 없는 스텝은 그림을 쓰지 않아 켜져 있다', async () => {
      const { w, s } = await mountSized()
      panelFixture([imageStep(0)])
      await w.vm.$nextTick()
      const item = (kind) => tid(w, `se-snap-new-${kind}`)
      const itemOff = (kind) => item(kind).attributes('disabled') !== undefined
      // 버튼은 켜져 있다(조건 없는 스텝을 만들 수 있다) — 메뉴 안에서 이미지·OCR 만 꺼지고 까닭을 알린다
      expect(off(w)).toBe(false)
      expect(btn(w).attributes('title')).toBeUndefined()
      await btn(w).trigger('click')
      expect([itemOff('image'), itemOff('ocr'), itemOff('none')]).toEqual([true, true, false]) // 고른 줄 없음
      expect(item('image').attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_NO_IMAGE)
      expect(item('ocr').attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_NO_IMAGE)
      const slow = defer()
      api.snapshotImage.mockImplementationOnce(() => slow.promise)
      s.select(name(1))
      await flushPromises()
      expect(itemOff('image')).toBe(true) // 받는 중
      slow.resolve({ data: new Blob(['x']) })
      await flushPromises()
      expect(itemOff('image')).toBe(true) // 받았지만 아직 그려지지 않았다
      w.vm.onLoad(IMG)
      await w.vm.$nextTick()
      expect([itemOff('image'), itemOff('ocr'), itemOff('none')]).toEqual([false, false, false])
      expect(item('image').attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_IMAGE_HINT)
      api.snapshotImage.mockImplementation(() => Promise.reject(blobFail(404, 'SNAPSHOT_NOT_FOUND')))
      s.select(name(4))
      await flushPromises()
      expect([itemOff('image'), itemOff('ocr'), itemOff('none')]).toEqual([true, true, false]) // 그림이 서버에 없다 — 메뉴는 열린 채
    })
    it('[새 스텝 ▾] → 조건 없는 스텝(사내 요청 2026-11-17): 스냅샷을 쓰지 않는 새 스텝을 맨 끝에 넣을 자리로 시작하고 메뉴를 닫는다', async () => {
      const { w, s } = await mountSized()
      panelFixture([imageStep(0)])
      const startNew = vi.spyOn(useEditStore(), 'startNew').mockReturnValue(true)
      await show(w, s, 1)
      await btn(w).trigger('click')
      expect(tid(w, 'se-snap-new-none').text()).toBe(MESSAGES.SEW_SNAP_STEP_NONE)
      expect(tid(w, 'se-snap-new-none').attributes('title')).toBe(MESSAGES.SEW_SNAP_STEP_NONE_HINT)
      await tid(w, 'se-snap-new-none').trigger('click')
      expect(startNew.mock.calls).toEqual([['none', { end: true }]])
      expect(tid(w, 'se-snap-new-none').exists()).toBe(false)
    })
    it('[새 스텝 ▾] → 이미지 스텝·OCR 스텝: 떠 있는 그림의 바이트로 새 스텝을 시작하고 메뉴를 닫는다', async () => {
      const blobs = new Map()
      api.snapshotImage.mockImplementation((eqpId, fileName) => { const b = new Blob([fileName]); blobs.set(fileName, b); return Promise.resolve({ data: b }) })
      const { w, s } = await mountSized()
      panelFixture([imageStep(0)])
      const startNew = vi.spyOn(useEditStore(), 'startNew').mockReturnValue(true)
      await show(w, s, 1)
      expect(tid(w, 'se-snap-new-image').exists()).toBe(false)
      await btn(w).trigger('click')
      expect(btn(w).attributes('aria-expanded')).toBe('true')
      await tid(w, 'se-snap-new-image').trigger('click')
      expect(startNew).toHaveBeenCalledTimes(1)
      const [kind, opts] = startNew.mock.calls[0]
      expect(kind).toBe('image')
      expect(opts.snapshot).toEqual({ eqpId: 'SEWT_A01', fileName: name(1), blob: blobs.get(name(1)) })
      expect(opts.snapshot.blob).toBe(blobs.get(name(1)))
      expect(tid(w, 'se-snap-new-image').exists()).toBe(false)
      await btn(w).trigger('click')
      await tid(w, 'se-snap-new-ocr').trigger('click')
      expect(startNew.mock.calls[1][0]).toBe('ocr')
      expect(startNew.mock.calls[1][1].snapshot.fileName).toBe(name(1))
    })
    it('메뉴는 Esc·바깥 누르기로 닫히고, 받기 메뉴와 함께 열리지 않는다', async () => {
      const { w, s } = await mountSized()
      panelFixture([imageStep(0)])
      await show(w, s, 1)
      await btn(w).trigger('click')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await w.vm.$nextTick()
      expect(tid(w, 'se-snap-new-image').exists()).toBe(false)
      await btn(w).trigger('click')
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await w.vm.$nextTick()
      expect(tid(w, 'se-snap-new-image').exists()).toBe(false)
      await btn(w).trigger('click')
      await tid(w, 'se-snap-download').trigger('click')
      expect(tid(w, 'se-snap-download-plain').exists()).toBe(true)
      expect(tid(w, 'se-snap-new-image').exists()).toBe(false)
    })
  })
})
