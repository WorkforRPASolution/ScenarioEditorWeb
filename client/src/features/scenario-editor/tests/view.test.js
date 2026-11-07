import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const replace = vi.fn()
const route = { query: {} }
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), open: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import ScenarioEditorView from '../ScenarioEditorView.vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { MESSAGES } from '../messages'
import { imageStep } from './panelFixture'

const ok = (data) => Promise.resolve({ data: { data } })
const stubs = { ScenarioBar: true, LoadDialog: true, StepTable: true, StepFlow: true, StepViewer: true, StepDetail: true, StepPanel: true, StepToolbar: true, EditDialogs: true, MultiSelection: true }
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
    expect(w.find('[data-testid="se-snapshot-rail"]').text()).toContain('스냅샷 — 준비 중')
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
      expect(appliedAtOpen).toBe(0.85)
      expect(useEditorStore().skeleton.name).toBe('B')
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
})
