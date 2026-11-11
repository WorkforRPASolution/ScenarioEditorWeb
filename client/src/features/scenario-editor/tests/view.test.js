import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { shallowMount, mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const replace = vi.fn()
const route = { query: {} }
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), open: vi.fn(), getDraft: vi.fn(), check: vi.fn(), equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import ScenarioEditorView from '../ScenarioEditorView.vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { useSnapshotStore } from '../stores/snapshotStore'
import { MESSAGES } from '../messages'
import { imageStep, noneStep } from './panelFixture'

enableAutoUnmount(afterEach) // 화면이 beforeunload 감시자를 달므로 시험마다 내린다
const ok = (data) => Promise.resolve({ data: { data } })
const stubs = { ScenarioBar: true, LoadDialog: true, NewScenarioDialog: true, StepTable: true, StepFlow: true, StepViewer: true, StepDetail: true, StepPanel: true, StepToolbar: true, EditDialogs: true, MultiSelection: true }
const mountView = () => shallowMount(ScenarioEditorView, { global: { stubs: { ...stubs, StatePanel: false, SplitGutter: false } } })
const skeletonOf = (name, crtime = 5, isCurrent = false) => ({ process: 'P', model: 'M', name, version: { crtime, isCurrent }, steps: [], notes: [] })
const defer = () => { let resolve; const promise = new Promise((res) => { resolve = res }); return { promise, resolve } }

// 셸은 모든 라우트를 <keep-alive> 로 감싼다 — 같은 모양으로 화면을 켜고 끄며(show) 떠남·돌아옴을 흉내 낸다.
const mountKept = () => {
  const show = ref(true)
  const Other = defineComponent({ name: 'OtherPage', render: () => h('div', 'other') })
  const Wrapper = defineComponent({ render: () => h(KeepAlive, null, [show.value ? h(ScenarioEditorView, { key: 'se' }) : h(Other, { key: 'other' })]) })
  const w = mount(Wrapper, { global: { stubs: { ...stubs, StatePanel: false, SplitGutter: false } } })
  const leave = async () => { show.value = false; await nextTick() }
  const back = async () => { show.value = true; await nextTick(); await flushPromises() }
  return { w, leave, back }
}

describe('ScenarioEditorView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    api.me.mockReturnValue(ok({ singleid: 'u' })); api.scopes.mockReturnValue(ok({ processes: [] })); api.dataCheck.mockReturnValue(ok(null))
    route.query = {}
    replace.mockClear()
    localStorage.clear()
  })
  it('열린 시나리오가 없으면 빈 상태', async () => {
    const w = mountView(); await flushPromises()
    expect(w.find('[data-testid="se-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-snapshot-rail"]').text()).toBe('스냅샷')
  })
  it('미등록 사용자는 전체 안내만', async () => {
    api.me.mockRejectedValue({ response: { status: 403, data: { code: 'USER_NOT_REGISTERED' } } })
    const w = mountView(); await flushPromises()
    expect(w.find('[data-testid="se-unregistered"]').exists()).toBe(true)
    expect(w.findComponent({ name: 'ScenarioBar' }).exists()).toBe(false)
  })
  it('주소 쿼리가 있으면 바로 연다, 열리면 쿼리를 맞춘다', async () => {
    route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
    api.open.mockReturnValue(ok({ process: 'P', model: 'M', name: 'N', version: { crtime: 5, isCurrent: false }, steps: [], notes: [] }))
    mountView(); await flushPromises()
    expect(api.open).toHaveBeenCalledWith('P', 'M', 'N', '5')
    expect(replace).toHaveBeenCalledWith({ name: 'ScenarioEditor', query: { p: 'P', m: 'M', n: 'N', v: '5' } })
  })
  it('여는 중·오류 상태', async () => {
    const w = mountView(); await flushPromises()
    const s = useEditorStore()
    s.opening = { process: 'P', model: 'M', name: 'N', crtime: 'current', startedAt: Date.now() }
    await w.vm.$nextTick()
    expect(w.find('[data-testid="se-opening"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-opening"]').text()).toContain('시나리오를 여는 중 · 0초')
    s.opening = null
    s.openError = { code: 'DATA_INVALID', message: '열 수 없음', target: { process: 'P', model: 'M', name: 'N', crtime: 'current' } }
    await w.vm.$nextTick()
    expect(w.find('[data-testid="se-open-error"]').text()).toContain('열 수 없음')
  })
  it('경계선을 두 번 누르면 기본값', async () => {
    localStorage.setItem('se-layout', JSON.stringify({ rw: 500 }))
    const w = mountView(); await flushPromises()
    await w.find('[data-testid="se-gutter-r"]').trigger('dblclick')
    expect(JSON.parse(localStorage.getItem('se-layout')).rw).toBe(370)
  })
  describe('스냅샷 패널(P3-B)', () => {
    const cols = (w) => w.find('[data-testid="se-root"] .grid').attributes('style')
    beforeEach(() => { api.equipment.mockReturnValue(ok({ items: [] })) })
    it('접힌 띠를 누르면 패널이 펼쳐지고(기본 250px) 설비 목록을 받는다, 접으면 띠로 돌아온다', async () => {
      const w = mountView(); await flushPromises()
      expect(cols(w)).toContain('grid-template-columns: 36px 12px')
      expect(w.findComponent({ name: 'SnapshotPanel' }).exists()).toBe(false)
      expect(api.equipment).not.toHaveBeenCalled()
      await w.find('[data-testid="se-snapshot-rail"]').trigger('click')
      await flushPromises()
      expect(w.findComponent({ name: 'SnapshotPanel' }).exists()).toBe(true)
      expect(w.find('[data-testid="se-snapshot-rail"]').exists()).toBe(false)
      expect(cols(w)).toContain('grid-template-columns: 250px 12px')
      expect(api.equipment).toHaveBeenCalledTimes(1)
      await useSnapshotStore().setOpen(false)
      await w.vm.$nextTick()
      expect(w.find('[data-testid="se-snapshot-rail"]').exists()).toBe(true)
      expect(cols(w)).toContain('grid-template-columns: 36px 12px')
    })
    it('펼친 채 떠났으면 다시 켤 때 펼친 채로 시작한다', async () => {
      localStorage.setItem('se-snapshot', JSON.stringify({ open: true, eqpId: null }))
      const w = mountView(); await flushPromises()
      expect(w.findComponent({ name: 'SnapshotPanel' }).exists()).toBe(true)
    })
    it('왼쪽 경계선은 펼쳤을 때만 있고, 끌면 넓어지며 두 번 누르면 기본값', async () => {
      const width = window.innerWidth
      window.innerWidth = 1600 // 패널 폭의 상한은 화면 너비 − 1100 (시험 환경 기본 1024 에서는 하한 180 이 된다)
      onTestFinished(() => { window.innerWidth = width })
      const w = mountView(); await flushPromises()
      expect(w.find('[data-testid="se-gutter-l"]').exists()).toBe(false)
      await w.find('[data-testid="se-snapshot-rail"]').trigger('click')
      await flushPromises()
      await w.find('[data-testid="se-gutter-l"]').trigger('mousedown', { clientX: 300 })
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 360 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
      await w.vm.$nextTick()
      expect(cols(w)).toContain('grid-template-columns: 310px 12px')
      await w.find('[data-testid="se-gutter-l"]').trigger('dblclick')
      expect(cols(w)).toContain('grid-template-columns: 250px 12px')
    })
    it('열린 시나리오의 공정·모델을 설비 고르기에 넘긴다(그 설비가 먼저 온다)', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
      api.open.mockReturnValue(ok(skeletonOf('N')))
      const w = mountView(); await flushPromises()
      await w.find('[data-testid="se-snapshot-rail"]').trigger('click')
      await flushPromises()
      expect(w.findComponent({ name: 'SnapshotPanel' }).props('prefer')).toEqual({ process: 'P', model: 'M' })
    })
  })
  it('경계선 안내 문구는 문구 목록에서 온다', async () => {
    const w = mountView(); await flushPromises()
    expect(w.find('[data-testid="se-gutter-r"]').attributes('title')).toBe(MESSAGES.SEW_UI_GUTTER_HINT)
  })

  describe('편집 도구 줄', () => {
    const editedOf = (sk) => ({ source: { process: sk.process, model: sk.model, name: sk.name, crtime: sk.version.crtime, fileId: 'F' }, headCrtime: sk.version.crtime, header: { description: '', timeoutLimit: '1' }, steps: [], property: {} })
    const openWith = async (me, isCurrent) => {
      api.me.mockReturnValue(ok(me))
      route.query = { p: 'P', m: 'M', n: 'N' }
      const sk = skeletonOf('N', 5, isCurrent)
      api.open.mockReturnValue(ok({ ...sk, edited: editedOf(sk) }))
      const w = mountView(); await flushPromises()
      return w
    }
    it('쓸 수 있는 현재 판이면 도구 줄과 편집 창(삭제 막힘·알림)을 단다', async () => {
      const w = await openWith({ singleid: 'u', canWrite: true }, true)
      expect(w.findComponent({ name: 'StepToolbar' }).exists()).toBe(true)
      expect(w.findComponent({ name: 'EditDialogs' }).exists()).toBe(true)
    })
    it('쓸 수 있는 세션은 오른쪽에 편집 패널, 읽기 전용은 P1 상세', async () => {
      const a = await openWith({ singleid: 'u', canWrite: true }, true)
      expect(a.findComponent({ name: 'StepPanel' }).exists()).toBe(true)
      expect(a.findComponent({ name: 'StepDetail' }).exists()).toBe(false)
      a.unmount()
      setActivePinia(createPinia())
      const b = await openWith({ singleid: 'u', canWrite: true }, false)
      expect(b.findComponent({ name: 'StepPanel' }).exists()).toBe(false)
      expect(b.findComponent({ name: 'StepDetail' }).exists()).toBe(true)
    })
    it('도구 줄의 새 스텝 ▾ 에서 종류를 고르면 패널에 새 스텝 초안이 열린다', async () => {
      const w = await openWith({ singleid: 'u', canWrite: true }, true)
      w.findComponent({ name: 'StepToolbar' }).vm.$emit('new', 'none')
      const e = useEditStore()
      expect(e.panel.isNew).toBe(true)
      expect(e.panel.draft.condition.kind).toBe('none')
    })
    it('쓰기 권한이 없거나 옛 판이면 도구 줄이 없다', async () => {
      const a = await openWith({ singleid: 'u', canWrite: false }, true)
      expect(a.findComponent({ name: 'StepToolbar' }).exists()).toBe(false)
      a.unmount()
      setActivePinia(createPinia())
      const b = await openWith({ singleid: 'u', canWrite: true }, false)
      expect(b.findComponent({ name: 'StepToolbar' }).exists()).toBe(false)
    })
  })

  describe('다른 시나리오 열기 앞의 적용 안 한 변경 확인(guard)', () => {
    // 쓸 수 있는 현재 판, 스텝 하나(패널이 열린다)
    const writable = (name, crtime) => {
      const st = imageStep(0, { next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } } }) // 하나뿐인 스텝은 NEXT 를 못 쓴다
      const edited = { source: { process: 'P', model: 'M', name, crtime, fileId: 'F' }, headCrtime: crtime, header: { description: '', timeoutLimit: '1' }, steps: [st], property: {} }
      return { process: 'P', model: 'M', name, version: { crtime, isCurrent: true, fileId: 'F' }, headCrtime: crtime, notes: [],
        steps: [{ ...st, no: 1, notes: [], baseImage: { state: 'present', url: '/b' } }], edited }
    }
    const dirty = () => useEditStore().updateDraft((d) => ({ ...d, condition: { ...d.condition, image: { ...d.condition.image, accept: 0.85 } } }))
    const target = { process: 'P', model: 'M', name: 'B', crtime: 'current' }
    const openA = async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      route.query = { p: 'P', m: 'M', n: 'A' }
      api.open.mockReturnValue(ok(writable('A', 5)))
      const w = mountView(); await flushPromises()
      return w
    }
    it('불러오기 창에서 다른 시나리오를 고르면 먼저 묻고, [버리고 이동] 이면 연다', async () => {
      const w = await openA()
      const e = useEditStore()
      expect(e.panel.uid).toBe('s0')
      dirty()
      api.open.mockReturnValue(ok(writable('B', 7)))
      w.findComponent({ name: 'LoadDialog' }).vm.$emit('open', target)
      await flushPromises()
      expect(e.dialog).toEqual({ kind: 'guard', action: 'open', to: null })
      expect(api.open).toHaveBeenCalledTimes(1)
      e.guardDrop(); await flushPromises()
      expect(api.open).toHaveBeenLastCalledWith('P', 'M', 'B', 'current')
      expect(useEditorStore().skeleton.name).toBe('B')
    })
    it('[적용하고 이동] 은 작업본에 넣은 뒤 연다', async () => {
      const w = await openA()
      const e = useEditStore()
      dirty()
      let appliedAtOpen = null
      api.open.mockImplementation(() => { appliedAtOpen = e.session.working.steps[0].condition.image.accept; return ok(writable('B', 7)) })
      w.findComponent({ name: 'LoadDialog' }).vm.$emit('open', target)
      await flushPromises()
      e.guardApply(); await flushPromises()
      expect(e.dialog).toEqual({ kind: 'leave', n: 1 }) // 적용한 값은 저장 전 변경이라 한 번 더 묻는다
      e.leaveDrop(); await flushPromises()
      expect(appliedAtOpen).toBe(0.85)
      expect(useEditorStore().skeleton.name).toBe('B')
    })
    describe('저장 전 변경 확인(떠날 때)', () => {
      const unload = () => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented }
      it('스텝 하나를 고쳐 적용한 뒤 다른 시나리오를 열면 한 번 더 묻고, [버리고 열기] 면 연다', async () => {
        const w = await openA()
        const e = useEditStore()
        e.editCell('s0', 'descriptionToEmail', '고친 설명')
        expect(e.unsavedCount).toBe(1)
        api.open.mockReturnValue(ok(writable('B', 7)))
        w.findComponent({ name: 'LoadDialog' }).vm.$emit('open', target)
        await flushPromises()
        expect(e.dialog).toEqual({ kind: 'leave', n: 1 })
        expect(api.open).toHaveBeenCalledTimes(1)
        e.leaveDrop(); await flushPromises()
        expect(useEditorStore().skeleton.name).toBe('B')
      })
      it('[계속 고치기] 면 열지 않고 값이 남는다', async () => {
        const w = await openA()
        const e = useEditStore()
        e.setHeader('description', '새 제목')
        w.findComponent({ name: 'LoadDialog' }).vm.$emit('open', target)
        await flushPromises()
        expect(e.dialog.kind).toBe('leave')
        e.leaveKeep(); await flushPromises()
        expect(e.dialog).toBe(null)
        expect(api.open).toHaveBeenCalledTimes(1)
        expect(e.session.working.header.description).toBe('새 제목')
      })
      it('[적용하고 이동] 으로 패널 값을 넣은 경우에도 저장 전 변경으로 한 번 더 묻는다', async () => {
        const w = await openA()
        const e = useEditStore()
        dirty()
        w.findComponent({ name: 'LoadDialog' }).vm.$emit('open', target)
        await flushPromises()
        expect(e.dialog.kind).toBe('guard')
        e.guardApply(); await flushPromises()
        expect(e.dialog).toEqual({ kind: 'leave', n: 1 })
        expect(api.open).toHaveBeenCalledTimes(1)
      })
      it('고친 곳이 없으면 묻지 않고 떠나기 확인도 걸지 않는다', async () => {
        const w = await openA()
        const e = useEditStore()
        expect(unload()).toBe(false)
        api.open.mockReturnValue(ok(writable('B', 7)))
        w.findComponent({ name: 'LoadDialog' }).vm.$emit('open', target)
        await flushPromises()
        expect(e.dialog).toBe(null)
        expect(useEditorStore().skeleton.name).toBe('B')
      })
      it('저장 전 변경이 있으면 브라우저 떠나기 확인이 걸린다', async () => {
        await openA()
        useEditStore().setHeader('timeoutLimit', '15')
        expect(unload()).toBe(true)
      })
    })
    it('돌아왔을 때 주소가 다른 시나리오를 가리켜도 먼저 묻는다 — [계속 고치기] 면 주소를 열린 시나리오로 되돌린다', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      route.query = { p: 'P', m: 'M', n: 'A', v: 'current' }
      api.open.mockReturnValue(ok(writable('A', 5)))
      const { leave, back } = mountKept(); await flushPromises()
      dirty()
      await leave()
      route.query = { p: 'P', m: 'M', n: 'B', v: 'current' }
      replace.mockClear()
      await back()
      const e = useEditStore()
      expect(e.dialog).toEqual({ kind: 'guard', action: 'open', to: null })
      expect(api.open).toHaveBeenCalledTimes(1)
      e.guardKeep(); await flushPromises()
      expect(replace).toHaveBeenCalledWith({ name: 'ScenarioEditor', query: { p: 'P', m: 'M', n: 'A', v: 'current' } })
      expect(api.open).toHaveBeenCalledTimes(1)
      expect(e.panel.draft.condition.image.accept).toBe(0.85)
    })
    it('돌아왔을 때 [적용하고 이동] 이 칸 오류로 막혀도 주소를 열린 시나리오로 되돌린다(열지 않는다)', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      route.query = { p: 'P', m: 'M', n: 'A', v: 'current' }
      api.open.mockReturnValue(ok(writable('A', 5)))
      const { leave, back } = mountKept(); await flushPromises()
      useEditStore().updateDraft((d) => ({ ...d, descriptionToEmail: 'a@b' })) // 칸 오류
      await leave()
      route.query = { p: 'P', m: 'M', n: 'B', v: 'current' }
      replace.mockClear()
      await back()
      const e = useEditStore()
      expect(e.dialog).toEqual({ kind: 'guard', action: 'open', to: null })
      expect(e.guardApply()).toBe(false)
      await flushPromises()
      expect(replace).toHaveBeenCalledWith({ name: 'ScenarioEditor', query: { p: 'P', m: 'M', n: 'A', v: 'current' } })
      expect(api.open).toHaveBeenCalledTimes(1)
      expect(useEditorStore().skeleton.name).toBe('A')
    })
    it('다른 시나리오를 여는 동안은 도구 줄·편집 패널·편집 창을 내리고 P1 상세만 보인다, 열리면 다시 단다', async () => {
      const w = await openA()
      const d = defer()
      api.open.mockReturnValue(d.promise)
      w.findComponent({ name: 'LoadDialog' }).vm.$emit('open', target)
      await nextTick()
      expect(useEditorStore().opening).not.toBe(null)
      expect(useEditStore().editable).toBe(false)
      expect(w.findComponent({ name: 'StepToolbar' }).exists()).toBe(false)
      expect(w.findComponent({ name: 'StepPanel' }).exists()).toBe(false)
      expect(w.findComponent({ name: 'EditDialogs' }).exists()).toBe(false)
      expect(w.findComponent({ name: 'StepDetail' }).exists()).toBe(true)
      d.resolve({ data: { data: writable('B', 7) } }); await flushPromises()
      expect(useEditorStore().skeleton.name).toBe('B')
      expect(w.findComponent({ name: 'StepToolbar' }).exists()).toBe(true)
      expect(w.findComponent({ name: 'StepPanel' }).exists()).toBe(true)
      expect(w.findComponent({ name: 'EditDialogs' }).exists()).toBe(true)
    })
  })

  describe('내 정보를 못 읽었을 때', () => {
    it('미등록이 아닌 실패는 안내 문구와 다시 시도 — 전체 화면 미등록 안내가 아니다', async () => {
      api.me.mockRejectedValue({ request: {} })
      const w = mountView(); await flushPromises()
      expect(w.find('[data-testid="se-unregistered"]').exists()).toBe(false)
      expect(w.find('[data-testid="se-open-error"]').text()).toContain(MESSAGES.SEW_ERR_NETWORK)
      expect(w.findComponent({ name: 'ScenarioBar' }).exists()).toBe(false)
    })
    it('다시 시도하면 내 정보를 다시 읽고, 주소 쿼리의 시나리오를 연다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N' }
      api.me.mockRejectedValueOnce({ request: {} })
      api.open.mockReturnValue(ok(skeletonOf('N', 1, true)))
      const w = mountView(); await flushPromises()
      expect(api.open).not.toHaveBeenCalled()
      await w.find('[data-testid="se-open-error"] button').trigger('click'); await flushPromises()
      expect(api.me).toHaveBeenCalledTimes(2)
      expect(api.open).toHaveBeenCalledWith('P', 'M', 'N', 'current')
      expect(w.find('[data-testid="se-open-error"]').exists()).toBe(false)
    })
    it('미등록이면 다시 시도 없이 전체 안내만', async () => {
      api.me.mockRejectedValue({ response: { status: 403, data: { code: 'USER_NOT_REGISTERED' } } })
      const w = mountView(); await flushPromises()
      expect(w.find('[data-testid="se-unregistered"]').exists()).toBe(true)
      expect(w.find('[data-testid="se-open-error"]').exists()).toBe(false)
    })
  })

  describe('keep-alive 안에서 (셸은 모든 화면을 keep-alive 로 감싼다)', () => {
    it('처음 켜질 때 한 번만 연다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
      api.open.mockReturnValue(ok(skeletonOf('N')))
      mountKept(); await flushPromises()
      expect(api.open).toHaveBeenCalledTimes(1)
    })
    it('다른 화면에 있는 동안 열기가 끝나도 그 화면의 주소를 바꾸지 않는다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
      const d = defer()
      api.open.mockReturnValue(d.promise)
      const { leave } = mountKept(); await flushPromises()
      replace.mockClear()
      await leave()
      d.resolve({ data: { data: skeletonOf('N') } }); await flushPromises()
      expect(useEditorStore().skeleton.name).toBe('N')
      expect(replace).not.toHaveBeenCalled()
    })
    it('쿼리 없이 돌아오면 열려 있는 시나리오의 쿼리를 다시 쓴다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
      api.open.mockReturnValue(ok(skeletonOf('N')))
      const { leave, back } = mountKept(); await flushPromises()
      await leave()
      route.query = {}
      replace.mockClear()
      await back()
      expect(replace).toHaveBeenCalledWith({ name: 'ScenarioEditor', query: { p: 'P', m: 'M', n: 'N', v: '5' } })
      expect(api.open).toHaveBeenCalledTimes(1)
    })
    it('떠난 동안 끝난 열기도, 돌아오면 쿼리에 반영된다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: 'current' }
      const d = defer()
      api.open.mockReturnValue(d.promise)
      const { leave, back } = mountKept(); await flushPromises()
      await leave()
      d.resolve({ data: { data: skeletonOf('N', 9, true) } }); await flushPromises()
      route.query = {}
      replace.mockClear()
      await back()
      expect(replace).toHaveBeenCalledWith({ name: 'ScenarioEditor', query: { p: 'P', m: 'M', n: 'N', v: 'current' } })
    })
    it('돌아왔을 때 쿼리가 열려 있는 시나리오와 같으면 아무것도 하지 않는다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
      api.open.mockReturnValue(ok(skeletonOf('N')))
      const { leave, back } = mountKept(); await flushPromises()
      await leave()
      replace.mockClear()
      await back()
      expect(replace).not.toHaveBeenCalled()
      expect(api.open).toHaveBeenCalledTimes(1)
    })
    it('돌아왔을 때 쿼리가 다른 시나리오를 가리키면 그것을 연다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
      api.open.mockReturnValue(ok(skeletonOf('N')))
      const { leave, back } = mountKept(); await flushPromises()
      await leave()
      route.query = { p: 'P', m: 'M', n: 'B', v: 'current' }
      api.open.mockReturnValue(ok(skeletonOf('B', 7, true)))
      await back()
      expect(api.open).toHaveBeenLastCalledWith('P', 'M', 'B', 'current')
    })
    it('열기가 진행 중이면 돌아와도 새로 열지 않는다', async () => {
      route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
      api.open.mockReturnValue(defer().promise)
      const { leave, back } = mountKept(); await flushPromises()
      await leave()
      route.query = { p: 'P', m: 'M', n: 'B', v: 'current' }
      await back()
      expect(api.open).toHaveBeenCalledTimes(1)
    })
  })
  describe('새 시나리오(P2-D Task 6)', () => {
    const NEW = { process: 'P', model: 'M', name: 'NEW_ONE', type: 1, description: '메일', timeoutLimit: '240' }
    const newDialog = (w) => w.findComponent({ name: 'NewScenarioDialog' })
    it('열린 시나리오가 없을 때 쓰기 권한이 있으면 "…새 시나리오를 만드세요." 와 [새 시나리오] — 누르면 새 시나리오 창', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      const w = mountView(); await flushPromises()
      expect(w.find('[data-testid="se-empty"]').text()).toContain(MESSAGES.SEW_UI_EMPTY_NEW)
      expect(newDialog(w).props('modelValue')).toBe(false)
      await w.find('[data-testid="se-empty-new"]').trigger('click')
      expect(newDialog(w).props('modelValue')).toBe(true)
    })
    it('쓰기 권한이 없으면 지금 문구 그대로이고 [새 시나리오] 가 없다', async () => {
      const w = mountView(); await flushPromises()
      expect(w.find('[data-testid="se-empty"]').text()).toContain(MESSAGES.SEW_UI_EMPTY)
      expect(w.find('[data-testid="se-empty-new"]').exists()).toBe(false)
    })
    it('바의 [새 시나리오]: 패널에 적용 안 한 변경이 있으면 먼저 묻고(guard new), [버리고 계속] 뒤 창이 열린다', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      route.query = { p: 'P', m: 'M', n: 'A' }
      const st = imageStep(0, { next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } } })
      const edited = { source: { process: 'P', model: 'M', name: 'A', crtime: 5, fileId: 'F' }, headCrtime: 5, header: { description: '', timeoutLimit: '1' }, steps: [st], property: {} }
      api.open.mockReturnValue(ok({ process: 'P', model: 'M', name: 'A', version: { crtime: 5, isCurrent: true, fileId: 'F' }, headCrtime: 5, notes: [], steps: [{ ...st, no: 1, notes: [], baseImage: { state: 'present', url: '/b' } }], edited }))
      const w = mountView(); await flushPromises()
      const e = useEditStore()
      e.updateDraft((d) => ({ ...d, descriptionToEmail: '고치는 중' }))
      w.findComponent({ name: 'ScenarioBar' }).vm.$emit('new')
      await nextTick()
      expect(e.dialog).toMatchObject({ kind: 'guard', action: 'new' })
      expect(newDialog(w).props('modelValue')).toBe(false)
      e.guardDrop()
      await nextTick()
      expect(newDialog(w).props('modelValue')).toBe(true)
    })
    it('새 시나리오를 만들면 주소 쿼리를 비운다(서버에 없는 시나리오를 다시 열지 않게), 돌아와도 쓰지 않는다', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      route.query = { p: 'P', m: 'M', n: 'N' }
      api.open.mockReturnValue(ok({ process: 'P', model: 'M', name: 'N', version: { crtime: 5, isCurrent: true }, steps: [], notes: [] }))
      const { leave, back } = mountKept(); await flushPromises()
      replace.mockClear()
      useEditStore().beginNew(NEW)
      await nextTick()
      expect(replace).toHaveBeenLastCalledWith({ name: 'ScenarioEditor', query: {} })
      route.query = {}
      await leave()
      replace.mockClear()
      await back()
      expect(replace).toHaveBeenLastCalledWith({ name: 'ScenarioEditor', query: {} })
      expect(api.open).toHaveBeenCalledTimes(1)
    })
    it('새 시나리오 창의 [초안 이어서 열기]는 그 초안을 바로 연다 — 배포한 적 없는 초안은 새 시나리오 세션', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      const scenario = { source: null, headCrtime: null, header: { description: '메일', timeoutLimit: '240' }, steps: [], property: { ID: 'P-M-X', Type: 1, IsEnabled: true } }
      api.getDraft.mockReturnValue(ok({ draftId: 'd1', savedAt: '2026-11-08T01:37:00.000Z', base: null, headCrtime: null, propertyRev: null, target: { model: 'M', name: 'X' }, scenario, imageUrls: {} }))
      const w = mountView(); await flushPromises()
      newDialog(w).vm.$emit('open-draft', { draftId: 'd1', process: 'P', model: 'M', name: 'X' })
      await flushPromises()
      expect(api.getDraft).toHaveBeenCalledWith('d1')
      expect(api.open).not.toHaveBeenCalled()
      expect(w.findComponent({ name: 'LoadDialog' }).props('modelValue')).toBe(false)
      const e = useEditStore()
      expect(e.session.source).toBe(null)
      // 이 기능(P2-F) 전의 초안이라 창 조건이 없다 — 빈 값으로 채워 연다
      expect(e.session.working).toEqual({ ...scenario, header: { ...scenario.header, windows: { target: { text: '', className: '', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 }, hiding: [] } } })
      expect(useEditorStore().skeleton).toMatchObject({ name: 'X', isNew: true })
    })
  })

  describe('불러오기 창에서 여는 길(P2-D Task 7)', () => {
    const loadDialog = (w) => w.findComponent({ name: 'LoadDialog' })
    const stepA = () => imageStep(0, { next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } } })
    const versionOf = (crtime, head, steps, over = {}) => {
      const edited = { source: { process: 'P', model: 'M', name: 'A', crtime, fileId: `F${crtime}` }, headCrtime: head, header: { description: 'm', timeoutLimit: '1' }, steps, property: { IsEnabled: true } }
      return { process: 'P', model: 'M', name: 'A', id: 'P-M-A', version: { crtime, isCurrent: crtime === head, fileId: `F${crtime}` }, headCrtime: head, propertyRev: `r${head}`, notes: [], header: { description: 'm', timeoutLimit: 1, targetWindow: null },
        steps: steps.map((x, i) => ({ ...x, no: i + 1, notes: [], baseImage: { state: 'present', url: '/b' } })), edited, ...over }
    }
    async function opened(w) {
      route.query = { p: 'P', m: 'M', n: 'A' }
      api.open.mockReturnValueOnce(ok(versionOf(9, 9, [stepA()])))
      const v = w ?? mountView(); await flushPromises()
      return v
    }
    it('[이 버전으로 되돌려 열기]: 저장 전 변경이 있으면 먼저 묻고, [버리고 열기] 뒤 옛 판·현재 판을 읽어 되돌린 작업본을 연다', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      const w = await opened()
      const e = useEditStore()
      e.setHeader('description', '고침')
      api.open.mockImplementation((p, m, n, v) => ok(v === 'current' ? versionOf(9, 9, [stepA()]) : versionOf(3, 9, [stepA(), noneStep(1)])))
      loadDialog(w).vm.$emit('restore', { process: 'P', model: 'M', name: 'A', crtime: 3 })
      await nextTick()
      expect(e.dialog).toMatchObject({ kind: 'leave', n: 1 })
      e.leaveDrop(); await flushPromises()
      expect(api.open).toHaveBeenCalledWith('P', 'M', 'A', '3')
      expect(api.open).toHaveBeenCalledWith('P', 'M', 'A', 'current')
      expect(e.session.restoredFrom).toBe(3)
      expect(e.session.source.crtime).toBe(3)
      expect(e.session.headCrtime).toBe(9)
      expect(e.toast.text).toContain('되돌린 작업본을 열었습니다')
      expect(replace).toHaveBeenLastCalledWith({ name: 'ScenarioEditor', query: { p: 'P', m: 'M', n: 'A', v: 'current' } })
    })
    it('불러오기 창의 [초안 이어서 열기]: 초안과 그 기준 판을 읽어 초안 세션 — 초안 시작 뒤 새 버전이 있으면 알린다', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      const w = await opened()
      const base = versionOf(5, 9, [stepA()])
      api.open.mockReturnValueOnce(ok(base))
      api.getDraft.mockReturnValue(ok({ draftId: 'd7', savedAt: '2026-11-07T05:23:51.000Z', base: { crtime: 5, fileId: 'F5' }, headCrtime: 5, propertyRev: 'r5', target: { model: 'M', name: 'A' },
        scenario: { ...base.edited, headCrtime: 5, header: { description: '초안', timeoutLimit: '1' } }, imageUrls: {} }))
      loadDialog(w).vm.$emit('open-draft', { process: 'P', model: 'M', name: 'A', draftId: 'd7' })
      await flushPromises()
      expect(api.open).toHaveBeenLastCalledWith('P', 'M', 'A', '5')
      const e = useEditStore()
      expect(e.session.working.header.description).toBe('초안')
      expect(e.session.fromDraft.stale).toBe(true)
      expect(e.draftId).toBe('d7')
      expect(e.toast.text).toContain('초안을 시작한 뒤 새 버전이 배포됐습니다')
    })
    it('원본이 지워진 초안: 기준 판이 없으면(404) 서버 사본을 force 검사로 보고, 있으면 초안 그대로 열고 없으면 열기 오류', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      const w = mountView(); await flushPromises()
      const gone = versionOf(5, 5, [stepA()])
      api.getDraft.mockReturnValue(ok({ draftId: 'd8', savedAt: '2026-11-07T05:23:51.000Z', base: { crtime: 5, fileId: 'F5' }, headCrtime: 5, propertyRev: 'r5', target: { model: 'M', name: 'A' }, scenario: gone.edited, imageUrls: {} }))
      api.open.mockRejectedValue({ response: { status: 404, data: { code: 'NOT_FOUND' } } })
      api.check.mockReturnValueOnce(ok({ blocks: [], warns: [], conflict: { kind: 'deleted' }, target: { exists: false, eqpCount: 1 }, targetExists: null }))
      loadDialog(w).vm.$emit('open-draft', { process: 'P', model: 'M', name: 'A', draftId: 'd8' })
      await flushPromises()
      expect(api.check.mock.calls[0][0].force).toBe(true)
      const e = useEditStore()
      expect(e.session.fromDraft.gone).toBe(true)
      expect(useEditorStore().skeleton.sourceGone).toBe(true)
      expect(replace).toHaveBeenLastCalledWith({ name: 'ScenarioEditor', query: {} }) // 지워진 판을 주소에 쓰지 않는다
      api.check.mockReturnValueOnce(ok({ blocks: [{ code: 'SOURCE_GONE' }], warns: [], conflict: { kind: 'deleted' }, target: { exists: false, eqpCount: 1 }, targetExists: null }))
      loadDialog(w).vm.$emit('open-draft', { process: 'P', model: 'M', name: 'A', draftId: 'd8' })
      await flushPromises()
      expect(w.find('[data-testid="se-open-error"]').text()).toContain('열 수 없습니다')
    })
    it('초안 열기가 실패하면 열기 오류의 [다시 시도]는 초안을 다시 연다(시나리오 열기가 아니다)', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      const w = mountView(); await flushPromises()
      api.getDraft.mockRejectedValueOnce({ response: { status: 503, data: { code: 'UPSTREAM_DOWN' } } })
      loadDialog(w).vm.$emit('open-draft', { process: 'P', model: 'M', name: 'X', draftId: 'd9' })
      await flushPromises()
      expect(w.find('[data-testid="se-open-error"]').exists()).toBe(true)
      api.getDraft.mockReturnValue(ok({ draftId: 'd9', savedAt: '2026-11-08T01:37:00.000Z', base: null, headCrtime: null, propertyRev: null, target: { model: 'M', name: 'X' },
        scenario: { source: null, headCrtime: null, header: { description: 'm', timeoutLimit: '240' }, steps: [], property: { ID: 'P-M-X', Type: 1 } }, imageUrls: {} }))
      await w.find('[data-testid="se-open-error"] button').trigger('click'); await flushPromises()
      expect(api.getDraft).toHaveBeenCalledTimes(2)
      expect(api.open).not.toHaveBeenCalled()
      expect(useEditStore().draftId).toBe('d9')
    })
    it('지워진 시나리오의 편집 화면: 지워짐 띠(저장 전 고친 곳은 볼 수만)와 [불러오기]', async () => {
      api.me.mockReturnValue(ok({ singleid: 'u', canWrite: true }))
      const w = await opened()
      const e = useEditStore()
      e.setHeader('description', '고침')
      expect(w.find('[data-testid="se-deleted-banner"]').exists()).toBe(false)
      e.markDeleted(); await nextTick()
      const band = w.find('[data-testid="se-deleted-banner"]')
      expect(band.text()).toContain('이 시나리오는 지워졌습니다')
      expect(band.text()).toContain('1곳')
      await band.find('button').trigger('click')
      expect(loadDialog(w).props('modelValue')).toBe(true)
    })
  })
})
