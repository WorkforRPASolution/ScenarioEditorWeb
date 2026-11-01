import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('@vue-flow/core', () => ({ VueFlow: { name: 'VueFlow', props: ['nodes', 'edges'], template: '<div />' }, useVueFlow: () => ({ setCenter: vi.fn(), findNode: () => null }), Handle: { template: '<i />' }, Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' } }))
vi.mock('@vue-flow/minimap', () => ({ MiniMap: { template: '<i />' } }))
vi.mock('@vue-flow/controls', () => ({ Controls: { template: '<i />' } }))
import StepFlow from '../components/StepFlow.vue'
import { useEditorStore } from '../stores/editorStore'

describe('StepFlow', () => {
  beforeEach(() => setActivePinia(createPinia()))
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
  it('스텝 0개면 빈 안내', () => {
    const s = useEditorStore(); s.skeleton = { steps: [], notes: [] }
    expect(mount(StepFlow).text()).toContain('스텝이 없습니다')
  })
})
