import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../gridTheme', () => ({ registerGrid: () => {}, useGridTheme: () => ({ value: {} }) }))
import { toRows, renderTarget, renderNo } from '../stepRows'
import { t } from '../messages'
import StepTable from '../components/StepTable.vue'
import { useEditorStore } from '../stores/editorStore'

const step = (over = {}) => ({ uid: 's0', no: 1, notes: [], condition: { kind: 'image', skipPreprocessing: false, image: { accept: 0.85 } },
  action: { typeName: 'MouseLeftClick' }, retry: { limit: 3, intervalMs: 2500 }, next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  descriptionToEmail: '<b>누르기</b>', ...over })

describe('toRows', () => {
  it('새 스텝을 넣을 자리 표시: 그 줄 앞이면 ins before, 맨 끝이면 마지막 줄에 ins after, 없으면 빈 값', () => {
    const steps = [step(), step({ uid: 's1', no: 2 }), step({ uid: 's2', no: 3 })]
    expect(toRows(steps, { insert: { before: 's1' } }).map((r) => r.ins)).toEqual(['', 'before', ''])
    expect(toRows(steps, { insert: { before: null } }).map((r) => r.ins)).toEqual(['', '', 'after'])
    expect(toRows(steps, {}).map((r) => r.ins)).toEqual(['', '', ''])
  })
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

// ── 편집(작업본이 있고 쓸 수 있는 세션) ──
import { useEditStore } from '../stores/editStore'
import TargetPicker from '../components/TargetPicker.vue'

const edStep = (i, over = {}) => ({
  uid: `s${i}`, origin: i,
  condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, image: { accept: 0.9, multi: { count: '1', op: 0 }, trainImages: [] } },
  action: { type: 0, typeName: 'None', raw: '' }, retry: { limit: 1, intervalMs: 2000 },
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  descriptionToEmail: `스텝${i}`, descriptionToDialog: '', isShowDialog: false,
  images: { train: {}, base: { from: 'source', id: `s${i}-bi` } }, ...over
})
const skOf = (e, i) => ({ ...e, no: i + 1, notes: [], baseImage: { state: 'present', url: `/u/${e.uid}` },
  next: { onTrue: e.next.onTrue.kind === 'step' ? { ...e.next.onTrue, no: Number(e.next.onTrue.uid.slice(1)) + 1 } : e.next.onTrue, onFalse: e.next.onFalse } })
// s2 의 성공 쪽이 s0(1번)을 가리킨다
function editFixture({ canWrite = true, isCurrent = true } = {}) {
  const steps = [edStep(0), edStep(1), edStep(2, { next: { onTrue: { kind: 'step', uid: 's0' }, onFalse: { kind: 'end', value: 'FAIL' } } }), edStep(3)]
  const edited = { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' }, headCrtime: 1, header: { description: '', timeoutLimit: '1' }, steps, property: {} }
  const skeleton = { process: 'P', model: 'M', name: 'N', headCrtime: 1, version: { crtime: 1, isCurrent, fileId: 'F' }, steps: steps.map(skOf), notes: [], edited }
  const s = useEditorStore(); s.skeleton = skeleton
  const e = useEditStore(); e.begin(skeleton, { canWrite })
  s.select('s0')
  return { s, e, edited }
}

describe('StepTable — 편집', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const AgStub = { name: 'AgGridVue', props: ['rowData', 'rowSelection', 'defaultColDef', 'columnDefs', 'context'], template: '<div />' }
  const mountTable = () => mount(StepTable, { global: { stubs: { AgGridVue: AgStub } }, attachTo: document.body })
  const grid = (w) => w.findComponent({ name: 'AgGridVue' })
  const click = (w, uid, mods = {}) => grid(w).vm.$emit('cell-clicked', { data: { uid }, event: { target: document.createElement('div'), ...mods } })
  const col = (w, field) => grid(w).props('columnDefs').find((c) => c.field === field)
  const cell = (w, field, uid) => {
    const c = col(w, field)
    const data = grid(w).props('rowData').find((r) => r.uid === uid)
    return c.cellRenderer({ value: data[field], data, colDef: c, context: grid(w).props('context') })
  }

  it('클릭 = 한 줄, Shift = 범위(기준 줄은 그대로), Ctrl/Cmd = 더하기·빼기', async () => {
    const { s, e } = editFixture()
    const w = mountTable()
    click(w, 's1')
    expect(e.selection).toEqual({ uids: ['s1'], anchor: 's1' })
    expect(s.selectedUid).toBe('s1')
    click(w, 's3', { shiftKey: true })
    expect(e.selection.uids).toEqual(['s1', 's2', 's3'])
    expect(s.selectedUid).toBe('s1')
    click(w, 's2', { ctrlKey: true })
    expect(e.selection.uids).toEqual(['s1', 's3'])
    click(w, 's0', { metaKey: true })
    expect(e.selection.uids).toEqual(['s0', 's1', 's3'])
    click(w, 's2')
    expect(e.selection).toEqual({ uids: ['s2'], anchor: 's2' })
    w.unmount()
  })

  it('여러 줄 선택이라 AG Grid 선택은 multiRow·클릭 선택 끔, 선택한 줄을 표에 맞춘다', async () => {
    const { e } = editFixture()
    const w = mountTable()
    expect(grid(w).props('rowSelection')).toMatchObject({ mode: 'multiRow', checkboxes: false, headerCheckbox: false, enableClickSelection: false })
    const nodes = ['s0', 's1', 's2', 's3'].map((id) => ({ id, sel: false, isSelected() { return this.sel }, setSelected(v) { this.sel = v } }))
    const api = { forEachNode: (f) => nodes.forEach(f), getRowNode: (id) => nodes.find((n) => n.id === id), ensureNodeVisible: vi.fn() }
    grid(w).vm.$emit('grid-ready', { api })
    e.setSelection({ uids: ['s1', 's2'], anchor: 's1' })
    await flushPromises()
    expect(nodes.map((n) => n.sel)).toEqual([false, true, true, false])
    w.unmount()
  })

  it('정확도 0.3 → 칸에 오류, 작업본 그대로 / 0.7 → 바로 들어가고 되돌리기로 되돌린다', () => {
    const { e, edited } = editFixture()
    const w = mountTable()
    const el = cell(w, 'accept', 's1')
    const input = el.tagName === 'INPUT' ? el : el.querySelector('input')
    expect(input.value).toBe('0.90')
    input.value = '0.3'
    input.dispatchEvent(new Event('change'))
    expect(input.classList.contains('se-cellnum-bad')).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.title).toBe('정확도는 0.5 이상만 받습니다.')
    expect(e.session.working).toBe(edited)
    input.value = '0.7'
    input.dispatchEvent(new Event('change'))
    expect(e.session.working.steps[1].condition.image.accept).toBe(0.7)
    expect(e.session.working.steps[0]).toBe(edited.steps[0])
    e.undoCommand()
    expect(e.session.working.steps).toBe(edited.steps)
    w.unmount()
  })

  it('칸 입력의 키는 칸 밖(AG Grid·표 단축키)으로 나가지 않는다 — AG Grid 가 Enter 로 칸을 다시 그리면 오류 표시가 사라진다', () => {
    editFixture()
    const w = mountTable()
    const outer = document.createElement('div')
    const seen = vi.fn()
    outer.addEventListener('keydown', seen)
    for (const field of ['accept', 'skip']) {
      const el = cell(w, field, 's1')
      outer.appendChild(el)
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
    expect(seen).not.toHaveBeenCalled()
    w.unmount()
  })

  it('전처리 스킵 체크는 바로 들어간다, 설비 상태는 칸이 없다', () => {
    const { e } = editFixture()
    const w = mountTable()
    const el = cell(w, 'skip', 's2')
    const box = el.tagName === 'INPUT' ? el : el.querySelector('input[type="checkbox"]')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(e.session.working.steps[2].condition.skipPreprocessing).toBe(true)
    w.unmount()
  })

  it('갈 곳을 누르면 고르기 창, 고르면 바로 들어간다', async () => {
    const { s, e } = editFixture()
    const w = mountTable()
    const btn = cell(w, 'onFalse', 's1')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.dataset.pick).toBe('s1:onFalse')
    grid(w).vm.$emit('cell-clicked', { data: { uid: 's1' }, event: { target: btn } })
    await flushPromises()
    expect(s.selectedUid).toBe('s1')
    const picker = w.findComponent(TargetPicker)
    expect(picker.exists()).toBe(true)
    expect(picker.props('selfUid')).toBe('s1')
    expect(picker.props('which')).toBe('onFalse')
    picker.vm.$emit('pick', { kind: 'end', value: 'SKIP' })
    await flushPromises()
    expect(e.session.working.steps[1].next.onFalse).toEqual({ kind: 'end', value: 'SKIP' })
    expect(w.findComponent(TargetPicker).exists()).toBe(false)
    w.unmount()
  })

  it('바뀐 줄 표시(고친 줄 ch·새 줄 nw)와 번호가 바뀐 갈 곳 강조', async () => {
    const { e } = editFixture()
    const w = mountTable()
    e.editCell('s1', 'skip', true)
    await flushPromises()
    const rows = () => Object.fromEntries(grid(w).props('rowData').map((r) => [r.uid, r]))
    expect(rows().s1.mark).toBe('ch')
    expect(rows().s0.mark).toBe('')
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    e.moveSelected(1) // s0 이 2번으로 → s2 의 성공 쪽 번호가 1 → 2
    await flushPromises()
    expect(rows().s2.onTrue).toBe('→2')
    expect(rows().s2.onTrueMoved).toBe(true)
    expect(rows().s1.onTrueMoved).toBe(false)
    w.unmount()
  })

  it('값이 같아도 다른 칸 값(표시·강조·종류)으로 그리는 칸은 줄이 바뀌면 다시 그린다, 바뀌지 않은 줄은 같은 객체', async () => {
    const { e } = editFixture()
    const w = mountTable()
    for (const f of ['no', 'accept', 'skip', 'onFalse', 'onTrue']) expect(col(w, f).equals?.(1, 1), f).toBe(false)
    expect(col(w, 'desc').equals).toBeUndefined()
    const before = grid(w).props('rowData')
    e.editCell('s1', 'skip', true)
    await flushPromises()
    const after = grid(w).props('rowData')
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    w.unmount()
  })

  it('단축키(표에 초점이 있을 때): Delete·Ctrl+Z·Shift+Ctrl+Z, 칸 입력 중에는 듣지 않는다', async () => {
    const { e } = editFixture()
    const w = mountTable()
    const table = w.find('[data-testid="se-step-table"]')
    e.setSelection({ uids: ['s1'], anchor: 's1' })
    await table.trigger('keydown', { key: 'Delete' })
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', 's2', 's3'])
    await table.trigger('keydown', { key: 'z', ctrlKey: true })
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', 's1', 's2', 's3'])
    await table.trigger('keydown', { key: 'Z', metaKey: true, shiftKey: true })
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', 's2', 's3'])
    const input = document.createElement('input')
    table.element.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', 's2', 's3'])
    w.unmount()
  })

  describe('패널에 적용 안 한 변경이 있을 때(Task 6) — 표 칸·Delete·Ctrl+V·↑↓ 도 확인 창을 거친다', () => {
    const dirty = (e) => e.updateDraft((d) => ({ ...d, descriptionToEmail: '고치는 중' }))
    it('표 칸(전처리 스킵·갈 곳)을 바꾸면 먼저 묻고, [버리고 이동] 뒤에 들어간다', async () => {
      const { e, edited } = editFixture()
      const w = mountTable()
      dirty(e)
      const box = cell(w, 'skip', 's2')
      box.checked = true
      box.dispatchEvent(new Event('change'))
      expect(e.dialog).toEqual({ kind: 'guard', action: 'command', to: null })
      expect(e.session.working).toBe(edited)
      e.guardDrop()
      expect(e.session.working.steps[2].condition.skipPreprocessing).toBe(true)
      expect(e.panel.draft.descriptionToEmail).toBe('스텝0')
      w.unmount()
    })
    it('Delete·Ctrl+V 도 먼저 묻는다', async () => {
      const { e, edited } = editFixture()
      const w = mountTable()
      const table = w.find('[data-testid="se-step-table"]')
      e.copySelection(false)
      dirty(e)
      await table.trigger('keydown', { key: 'Delete' })
      expect(e.dialog?.kind).toBe('guard')
      expect(e.session.working).toBe(edited)
      e.guardKeep()
      await table.trigger('keydown', { key: 'v', ctrlKey: true })
      expect(e.dialog?.kind).toBe('guard')
      expect(e.session.working).toBe(edited)
      w.unmount()
    })
    it('확인 창이 떠 있는 동안 표 단축키(↑↓·Delete)는 듣지 않는다', async () => {
      const { s, e, edited } = editFixture()
      const w = mountTable()
      const table = w.find('[data-testid="se-step-table"]')
      dirty(e)
      await table.trigger('keydown', { key: 'ArrowDown' })
      expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: 's1' })
      await table.trigger('keydown', { key: 'ArrowDown' })
      await table.trigger('keydown', { key: 'Delete' })
      expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: 's1' })
      expect(s.selectedUid).toBe('s0')
      expect(e.session.working).toBe(edited)
      w.unmount()
    })
    it('확인 창이 닫히면 표 칸을 작업본 값으로 다시 그린다(묻는 동안 친 값이 남지 않게)', async () => {
      const { e } = editFixture()
      const w = mountTable()
      const api = { forEachNode: () => {}, getRowNode: () => null, ensureNodeVisible: vi.fn(), refreshCells: vi.fn() }
      grid(w).vm.$emit('grid-ready', { api })
      dirty(e)
      e.editCell('s1', 'skip', true)
      await flushPromises()
      e.guardKeep()
      await flushPromises()
      expect(api.refreshCells).toHaveBeenCalledWith({ force: true })
      w.unmount()
    })
  })

  it('읽기 전용이면 표 칸 편집이 없고 P1 과 같다', () => {
    editFixture({ isCurrent: false })
    const w = mountTable()
    expect(grid(w).props('rowSelection')).toEqual({ mode: 'singleRow', checkboxes: false, enableClickSelection: 'enableSelection' })
    expect(col(w, 'accept').cellRenderer).toBeUndefined()
    expect(cell(w, 'onFalse', 's1').tagName).toBe('SPAN')
    w.unmount()
  })
})

// ── 빈 시나리오·다른 시나리오에서 붙인 스텝(Task 8) ──
import { panelFixture, imageStep, noneStep } from './panelFixture'
describe('StepTable — 빈 시나리오·미해결 갈 곳(Task 8)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const AgStub = { name: 'AgGridVue', props: ['rowData', 'rowSelection', 'defaultColDef', 'columnDefs', 'context'], template: '<div />' }
  const mountTable = () => mount(StepTable, { global: { stubs: { AgGridVue: AgStub } }, attachTo: document.body })

  it('스텝이 0개인 쓸 수 있는 세션: 빈 안내(목업 조작판 20) — [조건 없는 스텝 만들기]는 새 스텝 초안, [복사해 둔 스텝 붙여넣기]는 묶음이 있을 때만', async () => {
    // 다른 시나리오에서 복사해 둔 묶음
    const { e } = panelFixture([imageStep(0), noneStep(1)])
    e.setSelection({ uids: ['s0', 's1'], anchor: 's0' })
    e.copySelection(false)
    const clip = { ...e.clip, origin: { ...e.clip.origin, name: 'A' } } // 다른 시나리오 A 에서 복사한 것으로
    setActivePinia(createPinia())
    const { e: e2 } = panelFixture([])
    const w = mountTable()
    const empty = w.find('[data-testid="se-table-empty"]')
    expect(empty.text()).toContain('스텝이 아직 없습니다.')
    expect(empty.text()).toContain(t('SEW_EDIT_EMPTY_HELP'))
    expect(w.findComponent({ name: 'AgGridVue' }).exists()).toBe(false)
    const paste = w.find('[data-testid="se-empty-paste"]')
    expect(paste.attributes('disabled')).toBeDefined()
    await w.find('[data-testid="se-empty-new"]').trigger('click')
    expect(e2.panel).toMatchObject({ isNew: true })
    expect(e2.panel.draft.condition.kind).toBe('none')
    e2.cancelNew()
    e2.clip = clip
    await flushPromises()
    expect(paste.attributes('disabled')).toBeUndefined()
    await paste.trigger('click')
    expect(e2.session.working.steps).toHaveLength(2)
    expect(e2.session.working.steps[0].images.base).toEqual({ from: 'other', process: 'P', model: 'M', name: 'A', crtime: 1, fileId: 'F', id: 's0-bi' })
    await flushPromises()
    expect(w.find('[data-testid="se-table-empty"]').exists()).toBe(false)
    w.unmount()
  })
  it('읽기 전용 세션의 스텝 0개는 P1 안내 그대로', () => {
    panelFixture([], { canWrite: false })
    const w = mountTable()
    expect(w.text()).toContain('스텝이 없습니다.')
    expect(w.find('[data-testid="se-table-empty"]').exists()).toBe(false)
    w.unmount()
  })
  it('미해결 갈 곳 칸은 "미해결 N" 이고 짚으면 "갈 곳을 고르세요(원래 N번)."(원래 번호를 모르면 "갈 곳을 고르세요.")', () => {
    const el = renderTarget({ value: '미해결 7', colDef: { field: 'onFalse' }, data: { uid: 'p1', onFalseTarget: { kind: 'unresolved', value: 7 } }, context: { editable: true } })
    expect(el.title).toBe('갈 곳을 고르세요(원래 7번).')
    const el2 = renderTarget({ value: '미해결', colDef: { field: 'onTrue' }, data: { uid: 'p1', onTrueTarget: { kind: 'unresolved' } }, context: { editable: true } })
    expect(el2.title).toBe('갈 곳을 고르세요.')
    const el3 = renderTarget({ value: 'NEXT', colDef: { field: 'onTrue' }, data: { uid: 'p1', onTrueTarget: { kind: 'next' } }, context: { editable: true } })
    expect(el3.title).toBe('')
  })
})
