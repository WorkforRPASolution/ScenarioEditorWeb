import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../gridTheme', () => ({ registerGrid: () => {}, useGridTheme: () => ({ value: {} }) }))
import { toRows, renderTarget, renderNo } from '../stepRows'
import StepTable from '../components/StepTable.vue'
import { useEditorStore } from '../stores/editorStore'

const step = (over = {}) => ({ uid: 's0', no: 1, notes: [], condition: { kind: 'image', skipPreprocessing: false, image: { accept: 0.85 } },
  action: { typeName: 'MouseLeftClick' }, retry: { limit: 3, intervalMs: 2500 }, next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  descriptionToEmail: '<b>누르기</b>', ...over })

describe('toRows', () => {
  it('사내 표 열 값', () => {
    expect(toRows([step()])[0]).toMatchObject({ uid: 's0', no: 1, warn: false, info: false, condition: '이미지', accept: '0.85', retry: 3, interval: 2, skip: false,
      onTrue: 'NEXT', onFalse: 'FAIL', action: '마우스 클릭', desc: '<b>누르기</b>' })
  })
  it('이미지가 아니면 정확도 빈칸, 설비 상태는 전처리 스킵 null', () => {
    const r = toRows([step({ condition: { kind: 'eqpState', skipPreprocessing: null } })])[0]
    expect([r.accept, r.skip]).toEqual(['', null])
  })
  it('경고·알림 표시', () => {
    const r = toRows([step({ notes: [{ level: 'info', code: 'A' }] }), step({ uid: 's1', no: 2, notes: [{ level: 'warning', code: 'B' }] })])
    expect([r[0].warn, r[0].info, r[1].warn]).toEqual([false, true, true])
  })
  it('깨진 본문(조건 unknown·동작 null·설명 없음)도 던지지 않고 한 줄이 된다', () => {
    const r = toRows([step({ condition: { kind: 'unknown', skipPreprocessing: null }, action: { typeName: null, raw: '?' }, descriptionToEmail: undefined })])[0]
    expect([r.condition, r.accept, r.action, r.desc, r.skip]).toEqual(['알 수 없음', '', '알 수 없는 동작', '', null])
  })
})

describe('renderTarget (innerHTML 을 쓰지 않음)', () => {
  it('글자·종류 class·누를 수 있는지', () => {
    const el = renderTarget({ value: '→3', data: { onTrueTarget: { kind: 'step', uid: 's2', no: 3 } }, colDef: { field: 'onTrue' } })
    expect(el.textContent).toBe('→3')
    expect(el.className).toContain('se-pill-step')
    expect(el.dataset.go).toBe('s2')
    const raw = renderTarget({ value: '? -2', data: { onTrueTarget: { kind: 'raw', value: -2 } }, colDef: { field: 'onTrue' } })
    expect(raw.dataset.go).toBeUndefined()
  })
  it('HTML 글자는 태그로 해석하지 않고 글자로 둔다', () => {
    const el = renderTarget({ value: '<img src=x onerror=alert(1)>', data: { onFalseTarget: { kind: 'raw', value: 'x' } }, colDef: { field: 'onFalse' } })
    expect(el.children.length).toBe(0)
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>')
  })
  it('NO 칸은 경고 ⚠·알림 ⓘ 를 앞에 붙인다', () => {
    const text = (data) => renderNo({ value: 4, data }).textContent
    expect([text({ warn: true, info: false }), text({ warn: false, info: true }), text({ warn: false, info: false })]).toEqual(['⚠ 4', 'ⓘ 4', '4'])
  })
})

describe('StepTable', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const AgStub = { name: 'AgGridVue', props: ['rowData'], template: '<div />' }
  it('스텝 0개면 빈 안내', () => {
    const s = useEditorStore(); s.skeleton = { steps: [], notes: [] }
    const w = mount(StepTable, { global: { stubs: { AgGridVue: AgStub } } })
    expect(w.text()).toContain('스텝이 없습니다')
  })
  it('↑↓ 로 선택을 옮긴다', async () => {
    const s = useEditorStore(); s.skeleton = { steps: [step(), step({ uid: 's1', no: 2 })], notes: [] }; s.selectedUid = 's0'
    const w = mount(StepTable, { global: { stubs: { AgGridVue: AgStub } } })
    await w.find('[data-testid="se-step-table"]').trigger('keydown', { key: 'ArrowDown' })
    expect(s.selectedUid).toBe('s1')
  })
  it('다음 스텝 표시를 누르면 그 스텝으로', () => {
    const s = useEditorStore(); s.skeleton = { steps: [step(), step({ uid: 's1', no: 2 })], notes: [] }
    const w = mount(StepTable, { global: { stubs: { AgGridVue: AgStub } } })
    const span = document.createElement('span'); span.dataset.go = 's1'
    w.findComponent({ name: 'AgGridVue' }).vm.$emit('cell-clicked', { data: { uid: 's0' }, event: { target: span } })
    expect(s.selectedUid).toBe('s1')
  })
})
