import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

describe('toRows — 값이 빠진 스텝', () => {
  it('정확도·재시도·간격이 숫자가 아니면 NaN 대신 빈칸', () => {
    const blank = (over) => { const r = toRows([step(over)])[0]; return [r.accept, r.retry, r.interval] }
    expect(blank({ condition: { kind: 'image', skipPreprocessing: false, image: {} }, retry: {} })).toEqual(['', '', ''])
    expect(blank({ condition: { kind: 'image', skipPreprocessing: false, image: { accept: 'abc' } }, retry: { limit: null, intervalMs: 'x' } })).toEqual(['', '', ''])
    expect(blank({ retry: undefined })).toEqual(['0.85', '', ''])
    expect(blank({ retry: { limit: 0, intervalMs: 0 } })).toEqual(['0.85', 0, 0])
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
  // 진짜 AG Grid 는 지워질 때 gridPreDestroyed 를 보낸다 — 그걸 흉내 낸다.
  const AgStub = { name: 'AgGridVue', props: ['rowData', 'rowSelection', 'defaultColDef'], beforeUnmount() { this.$emit('grid-pre-destroyed') }, template: '<div />' }
  const fakeApi = (uids) => {
    const nodes = Object.fromEntries(uids.map((u) => [u, { setSelected: vi.fn() }]))
    return { nodes, api: { getRowNode: vi.fn((id) => nodes[id]), ensureNodeVisible: vi.fn() } }
  }
  const mountTable = () => mount(StepTable, { global: { stubs: { AgGridVue: AgStub } } })
  const grid = (w) => w.findComponent({ name: 'AgGridVue' })
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

  it('표는 정렬하지 않는다(순서가 ↑↓·순서도와 같아야 한다)', () => {
    const s = useEditorStore(); s.skeleton = { steps: [step()], notes: [] }
    expect(grid(mountTable()).props('defaultColDef')).toEqual({ sortable: false })
  })
  it('클릭으로 선택은 되지만 Ctrl/Cmd 클릭으로 선택이 풀리지는 않는다', () => {
    const s = useEditorStore(); s.skeleton = { steps: [step()], notes: [] }
    expect(grid(mountTable()).props('rowSelection')).toEqual({ mode: 'singleRow', checkboxes: false, enableClickSelection: 'enableSelection' })
  })

  describe('선택 맞추기(표 강조 ↔ store.selectedUid)', () => {
    const setup = () => {
      const s = useEditorStore(); s.skeleton = { steps: [step(), step({ uid: 's1', no: 2 })], notes: [] }; s.selectedUid = 's0'
      const w = mountTable(); const f = fakeApi(['s0', 's1'])
      grid(w).vm.$emit('grid-ready', { api: f.api })
      return { s, w, ...f }
    }
    it('표가 준비되면 선택된 행을 고르고, 선택이 바뀌면 그 행을 고르고 보이게 한다', async () => {
      const { s, nodes, api } = setup()
      expect(nodes.s0.setSelected).toHaveBeenCalledWith(true, true)
      s.selectedUid = 's1'
      await flushPromises()
      expect(nodes.s1.setSelected).toHaveBeenCalledWith(true, true)
      expect(api.ensureNodeVisible).toHaveBeenLastCalledWith(nodes.s1)
    })
    it('이미 선택된 스텝을 가리키는 표시를 눌러도 표 강조를 store 에 다시 맞춘다', async () => {
      const { s, w, nodes } = setup()
      s.selectedUid = 's1'; await flushPromises()
      nodes.s1.setSelected.mockClear()
      const span = document.createElement('span'); span.dataset.go = 's1'
      grid(w).vm.$emit('cell-clicked', { data: { uid: 's0' }, event: { target: span } }) // 0번 줄을 눌러 AG Grid 가 0번 줄을 강조한 상황
      await flushPromises()
      expect(s.selectedUid).toBe('s1')
      expect(nodes.s1.setSelected).toHaveBeenCalledWith(true, true)
    })
    it('표가 사라지면(스텝 0개) 옛 api 를 더 부르지 않는다', async () => {
      const { s, api } = setup()
      s.skeleton = { steps: [], notes: [] }
      await flushPromises()
      api.getRowNode.mockClear()
      s.selectedUid = 's1'
      await flushPromises()
      expect(api.getRowNode).not.toHaveBeenCalled()
    })
  })
})
