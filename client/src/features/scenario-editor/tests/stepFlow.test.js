import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
// useVueFlow 는 매번 같은 setCenter 감시자와 init 훅 수집기를 돌려준다(StepFlow 가 어떤 id 로 불렀는지도 남긴다).
const flow = vi.hoisted(() => ({ setCenter: vi.fn(), inits: [], ids: [] }))
vi.mock('@vue-flow/core', () => ({
  VueFlow: { name: 'VueFlow', props: ['id', 'nodes', 'edges'], template: '<div />' },
  useVueFlow: (id) => { flow.ids.push(id); return { setCenter: flow.setCenter, onInit: (fn) => flow.inits.push(fn), findNode: () => null, getViewport: () => ({ x: 0, y: 0, zoom: 0.4 }) } },
  Handle: { template: '<i />' },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' }
}))
vi.mock('@vue-flow/minimap', () => ({ MiniMap: { template: '<i />' } }))
vi.mock('@vue-flow/controls', () => ({ Controls: { template: '<i />' } }))
import StepFlow from '../components/StepFlow.vue'
import { useEditorStore } from '../stores/editorStore'

const step = (i, next = { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } }) =>
  ({ uid: `s${i}`, no: i + 1, notes: [], condition: { kind: 'none' }, action: { typeName: 'None' }, descriptionToEmail: '', next })
const skeletonOf = (n) => ({ steps: Array.from({ length: n }, (_, i) => step(i)), notes: [] })
// 카드 s1(번호 2)의 중심: x = 1 * (CW + GAP) + CW / 2, y = CH / 2 + 40
const S1_CENTER = [410, 76]

describe('StepFlow', () => {
  beforeEach(() => { setActivePinia(createPinia()); flow.setCenter.mockClear(); flow.inits.length = 0; flow.ids.length = 0 })
  it('배치 결과를 넘기고, 카드를 누르면 선택', () => {
    const s = useEditorStore()
    s.skeleton = { steps: [{ uid: 's0', no: 1, notes: [], condition: { kind: 'none' }, action: { typeName: 'None' }, descriptionToEmail: '', next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } } }], notes: [] }
    const w = mount(StepFlow)
    const vf = w.findComponent({ name: 'VueFlow' })
    expect(vf.props('nodes').filter((n) => n.type === 'step')).toHaveLength(1)
    vf.vm.$emit('node-click', { node: { id: 's0', type: 'step' } })
    expect(s.selectedUid).toBe('s0')
    vf.vm.$emit('node-click', { node: { id: 's0-onTrue', type: 'chip' } })
    expect(s.selectedUid).toBe('s0')
  })
  it('카드·칩 슬롯: 손상된 스텝(알 수 없는 조건·동작 없음·원문 다음)도 그려진다', () => {
    const s = useEditorStore()
    s.skeleton = { steps: [{ uid: 's0', no: 1, notes: [{ level: 'warning' }], condition: { kind: 'unknown' }, action: { typeName: null }, descriptionToEmail: '메일 설명', next: { onTrue: { kind: 'raw', value: 7 }, onFalse: { kind: 'step', uid: 'zz', no: 9 } } }], notes: [] }
    const SlotFlow = { name: 'VueFlow', props: ['nodes', 'edges'], template: '<div><template v-for="n in nodes" :key="n.id"><slot :name="`node-${n.type}`" :id="n.id" :data="n.data" /></template></div>' }
    const w = mount(StepFlow, { global: { stubs: { VueFlow: SlotFlow } } })
    expect(w.get('[data-testid="se-flow-node-1"]').text()).toContain('메일 설명')
    expect(w.get('[data-testid="se-flow-node-1"]').text()).toContain('⚠')
    expect(w.findAll('.se-pill').map((p) => p.text())).toEqual(['? 7', '→9'])
  })
  it('칩 폭: 다음 카드가 있는 옆(✓) 칩만 고정 폭+말줄임, 나머지는 라벨 전체가 보이게 자란다', () => {
    const s = useEditorStore()
    const raw = { kind: 'raw', value: 4294967295 }
    s.skeleton = { steps: [step(0, { onTrue: raw, onFalse: { kind: 'end', value: 'FAIL' } }), step(1, { onTrue: { kind: 'next' }, onFalse: raw })], notes: [] }
    const SlotFlow = { name: 'VueFlow', props: ['nodes', 'edges'], template: '<div><template v-for="n in nodes" :key="n.id"><slot :name="`node-${n.type}`" :id="n.id" :data="n.data" /></template></div>' }
    const w = mount(StepFlow, { global: { stubs: { VueFlow: SlotFlow } } })
    const [besideCapped, belowFail, besideLast, belowRaw] = w.findAll('.se-pill') // s0-onTrue, s0-onFalse, s1-onTrue, s1-onFalse
    // 옆 칩(다음 카드 있음): 폭 70 고정 + 말줄임 + 전체 라벨은 title
    expect(besideCapped.element.style.width).toBe('70px')
    expect(besideCapped.element.style.textOverflow).toBe('ellipsis')
    expect(besideCapped.attributes('title')).toBe('? 4294967295')
    // 마지막 스텝의 옆 칩과 아래 칩: 최소 폭만, 말줄임·고정 폭 없음, 라벨 전체
    for (const [pill, label] of [[besideLast, 'NEXT (다음 없음)'], [belowRaw, '? 4294967295'], [belowFail, 'FAIL']]) {
      expect(pill.text()).toBe(label)
      expect(pill.attributes('title')).toBe(label)
      expect(pill.element.style.minWidth).toBe('70px')
      expect(pill.element.style.width).toBe('')
      expect(pill.element.style.textOverflow).toBe('')
      expect(pill.element.style.overflow).toBe('')
    }
    // 아래 칩은 카드 폭 상자 안 가운데, 옆 칩은 제 폭만
    expect(belowRaw.element.parentElement.style.width).toBe('220px')
    expect(belowRaw.element.parentElement.style.justifyContent).toBe('center')
    expect(besideLast.element.parentElement.style.width).toBe('')
  })
  it('useVueFlow 와 <VueFlow> 가 같은 id(se-flow)를 쓴다', () => {
    const s = useEditorStore(); s.skeleton = skeletonOf(2)
    const w = mount(StepFlow)
    expect(w.findComponent({ name: 'VueFlow' }).props('id')).toBe('se-flow')
    expect(flow.ids).toEqual(['se-flow'])
  })
  it('표에서 고른 뒤 순서도가 처음 그려지면(init) 선택한 카드로 확대 1 로 간다', () => {
    const s = useEditorStore(); s.skeleton = skeletonOf(3); s.select('s1')
    mount(StepFlow)
    expect(flow.setCenter).not.toHaveBeenCalled() // init 전에는 아무것도 하지 않는다
    expect(flow.inits).toHaveLength(1)
    flow.inits[0]()
    expect(flow.setCenter).toHaveBeenCalledTimes(1)
    expect(flow.setCenter).toHaveBeenCalledWith(...S1_CENTER, { zoom: 1, duration: 0 })
  })
  it('선택이 없으면 init 에서 가운데로 가지 않는다(fit-view 에 맡김)', () => {
    const s = useEditorStore(); s.skeleton = skeletonOf(3)
    mount(StepFlow)
    flow.inits[0]()
    expect(flow.setCenter).not.toHaveBeenCalled()
  })
  it('다른 시나리오가 열리면(선택 uid 가 그대로여도) 선택한 카드로 다시 간다', async () => {
    const s = useEditorStore(); s.skeleton = skeletonOf(3); s.select('s1')
    mount(StepFlow)
    s.skeleton = skeletonOf(200) // 열기: 스켈레톤만 바뀌고 selectedUid 는 s1 그대로
    await flushPromises()
    expect(flow.setCenter).toHaveBeenCalledTimes(1)
    expect(flow.setCenter).toHaveBeenCalledWith(...S1_CENTER, { zoom: 1, duration: 300 })
  })
  it('열기에서 스켈레톤과 선택이 함께 바뀌어도 한 번만 간다', async () => {
    const s = useEditorStore(); s.skeleton = skeletonOf(3); s.select('s1')
    mount(StepFlow)
    s.skeleton = skeletonOf(5); s.select('s0')
    await flushPromises()
    expect(flow.setCenter).toHaveBeenCalledTimes(1)
    expect(flow.setCenter).toHaveBeenCalledWith(110, 76, { zoom: 1, duration: 300 })
  })
  it('표·상세에서 고른 선택은 확대 1 로 가운데에 놓는다', async () => {
    const s = useEditorStore(); s.skeleton = skeletonOf(3); s.select('s0')
    mount(StepFlow)
    s.select('s1')
    await flushPromises()
    expect(flow.setCenter).toHaveBeenCalledWith(...S1_CENTER, { zoom: 1, duration: 300 })
  })
  it('순서도 안에서 카드를 눌러 고르면 보던 위치·확대를 그대로 둔다', async () => {
    const s = useEditorStore(); s.skeleton = skeletonOf(3); s.select('s0')
    const w = mount(StepFlow)
    const vf = w.findComponent({ name: 'VueFlow' })
    vf.vm.$emit('node-click', { node: { id: 's1', type: 'step' } })
    await flushPromises()
    expect(s.selectedUid).toBe('s1')
    expect(flow.setCenter).not.toHaveBeenCalled()
    // 이미 선택된 카드를 다시 눌러도 표시가 남지 않는다 — 뒤이은 표 선택은 정상적으로 가운데로 간다.
    vf.vm.$emit('node-click', { node: { id: 's1', type: 'step' } })
    s.select('s0')
    await flushPromises()
    s.select('s1')
    await flushPromises()
    expect(flow.setCenter).toHaveBeenCalledTimes(2)
    expect(flow.setCenter).toHaveBeenLastCalledWith(...S1_CENTER, { zoom: 1, duration: 300 })
  })
  it('스텝 0개면 빈 안내', () => {
    const s = useEditorStore(); s.skeleton = { steps: [], notes: [] }
    expect(mount(StepFlow).text()).toContain('스텝이 없습니다')
  })
})
