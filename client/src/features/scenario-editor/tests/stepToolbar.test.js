import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => p }))
import StepToolbar from '../components/StepToolbar.vue'
import EditDialogs from '../components/EditDialogs.vue'
import MultiSelection from '../components/MultiSelection.vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'

const edStep = (i, over = {}) => ({
  uid: `s${i}`, origin: i,
  condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, image: { accept: 0.9, multi: { count: '1', op: 0 }, trainImages: [] } },
  action: { type: 0, typeName: 'None', raw: '' }, retry: { limit: 1, intervalMs: 2000 },
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  descriptionToEmail: `스텝${i}`, descriptionToDialog: '', isShowDialog: false,
  images: { train: {}, base: { from: 'source', id: `s${i}-bi` } }, ...over
})
const skOf = (e, i) => ({ ...e, no: i + 1, notes: [], baseImage: { state: 'present', url: `/u/${e.uid}` } })
// s2 의 성공 쪽이 s0(1번)을, s3 의 실패 쪽도 s0 을 가리킨다
function fixture({ canWrite = true, isCurrent = true, steps } = {}) {
  const list = steps ?? [edStep(0), edStep(1), edStep(2, { next: { onTrue: { kind: 'step', uid: 's0' }, onFalse: { kind: 'end', value: 'FAIL' } } }),
    edStep(3, { next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'step', uid: 's0' } } })]
  const edited = { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' }, headCrtime: 1, header: { description: '', timeoutLimit: '1' }, steps: list, property: {} }
  const skeleton = { process: 'P', model: 'M', name: 'N', headCrtime: 1, version: { crtime: 1, isCurrent, fileId: 'F' }, steps: list.map(skOf), notes: [], edited }
  const s = useEditorStore(); s.skeleton = skeleton
  const e = useEditStore(); e.begin(skeleton, { canWrite })
  if (list.length) s.select(list[0].uid)
  return { s, e, edited }
}
const Host = defineComponent({ render: () => h('div', [h(StepToolbar), h(MultiSelection), h(EditDialogs)]) })
const mountHost = () => mount(Host, { attachTo: document.body })
const tool = (w, name) => w.find(`[data-testid="se-tool-${name}"]`)
const off = (b) => b.attributes('disabled') !== undefined
const uids = (e) => e.session.working.steps.map((x) => x.uid)

describe('StepToolbar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('떨어진 줄이면 복사·잘라내기·이동이 꺼지고 지우기는 된다, 이어진 줄이면 켜진다', async () => {
    const { e } = fixture()
    const w = mountHost()
    e.setSelection({ uids: ['s0', 's2'], anchor: 's0' })
    await flushPromises()
    expect([off(tool(w, 'copy')), off(tool(w, 'cut')), off(tool(w, 'up')), off(tool(w, 'down')), off(tool(w, 'delete'))]).toEqual([true, true, true, true, false])
    expect(w.text()).toContain('2개 선택')
    expect(w.text()).toContain('4 / 200')
    e.setSelection({ uids: ['s1', 's2'], anchor: 's1' })
    await flushPromises()
    expect([off(tool(w, 'copy')), off(tool(w, 'cut')), off(tool(w, 'up')), off(tool(w, 'down'))]).toEqual([false, false, false, false])
    w.unmount()
  })

  it('여러 줄을 고르면 오른쪽에 목록, 떨어진 줄이면 이유를 보인다', async () => {
    const { e } = fixture()
    const w = mountHost()
    e.setSelection({ uids: ['s2', 's0'], anchor: 's0' })
    await flushPromises()
    const m = w.find('[data-testid="se-multi"]')
    expect(m.text()).toContain('스텝 2개 선택')
    expect(m.text()).toContain('떨어진 스텝이 섞여 있습니다.')
    expect(m.text()).toContain('스텝 복사/잘라내기를 위해서는 반드시 연결된 스텝을 선택해야 합니다.')
    expect(m.findAll('li').map((li) => li.text().replace(/\s+/g, ''))).toEqual(['1스텝0', '3스텝2'])
    w.unmount()
  })

  it('맨 위 줄은 위로, 맨 아래 줄은 아래로를 끈다', async () => {
    const { e } = fixture()
    const w = mountHost()
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    await flushPromises()
    expect([off(tool(w, 'up')), off(tool(w, 'down'))]).toEqual([true, false])
    await tool(w, 'down').trigger('click')
    expect(uids(e)).toEqual(['s1', 's0', 's2', 's3'])
    expect(e.toast.text).toContain('1번 스텝을 아래로 옮겼습니다.')
    expect(e.toast.text).toContain('다른 스텝의 번호 2곳이 새 번호를 따라갔습니다.')
    w.unmount()
  })

  it('가리키는 스텝이 있으면 지우기가 막히고 목록을 보인다, 목록을 누르면 그 스텝으로 간다', async () => {
    const { s, e, edited } = fixture()
    const w = mountHost()
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    await flushPromises()
    await tool(w, 'delete').trigger('click')
    expect(e.session.working).toBe(edited)
    const d = w.find('[data-testid="se-delblock"]')
    expect(d.text()).toContain('1번 스텝을 지울 수 없습니다')
    const refs = d.findAll('[data-ref]')
    expect(refs.map((r) => r.text().replace(/\s+/g, ''))).toEqual(['3스텝2성공시→1', '4스텝3실패시→1'])
    await refs[1].trigger('click')
    expect(s.selectedUid).toBe('s3')
    expect(e.selection).toEqual({ uids: ['s3'], anchor: 's3' })
    expect(e.dialog).toBe(null)
    expect(w.find('[data-testid="se-delblock"]').exists()).toBe(false)
    w.unmount()
  })

  it('지우면 다음 줄을 고르고 알림에 되돌리기가 있다', async () => {
    const { s, e } = fixture()
    const w = mountHost()
    e.setSelection({ uids: ['s1'], anchor: 's1' })
    await flushPromises()
    await tool(w, 'delete').trigger('click')
    expect(uids(e)).toEqual(['s0', 's2', 's3'])
    expect(s.selectedUid).toBe('s2')
    await flushPromises()
    const toast = w.find('[data-testid="se-toast"]')
    expect(toast.text()).toContain('2번 스텝을 지웠습니다.')
    await toast.find('button').trigger('click')
    expect(uids(e)).toEqual(['s0', 's1', 's2', 's3'])
    expect(s.selectedUid).toBe('s1')
    w.unmount()
  })

  it('복사 → 붙여넣기 ▾ 의 뒤에·앞에·끝에', async () => {
    const { e } = fixture()
    const w = mountHost()
    e.setSelection({ uids: ['s1'], anchor: 's1' })
    await flushPromises()
    expect(off(tool(w, 'paste'))).toBe(true)
    await tool(w, 'copy').trigger('click')
    expect(off(tool(w, 'paste'))).toBe(false)
    await tool(w, 'paste').trigger('click')
    const items = w.findAll('[data-paste]')
    expect(items.map((b) => b.attributes('data-paste'))).toEqual(['after', 'before', 'end'])
    expect(items[0].text()).toContain('2번 뒤에 붙여넣기')
    await items[0].trigger('click')
    expect(e.session.working.steps).toHaveLength(5)
    expect(e.session.working.steps[2].descriptionToEmail).toBe('스텝1')
    expect(e.session.working.steps[2].uid).not.toBe('s1')
    expect(e.toast.text).toContain('스텝 1개를 붙여넣었습니다.')
    w.unmount()
  })

  it('설비 상태 스텝이 든 묶음은 붙여넣기 전에 알리고, 그래도 붙일 수 있다', async () => {
    const eqp = edStep(1, { condition: { kind: 'eqpState', skipPreprocessing: null, eqpState: { target: 'MAIN' } } })
    const { e } = fixture({ steps: [edStep(0), eqp] })
    const w = mountHost()
    e.setSelection({ uids: ['s1'], anchor: 's1' })
    await flushPromises()
    await tool(w, 'copy').trigger('click')
    await tool(w, 'paste').trigger('click')
    await w.find('[data-paste="end"]').trigger('click')
    expect(e.session.working.steps).toHaveLength(2)
    const d = w.find('[data-testid="se-paste-warn"]')
    expect(d.text()).toContain('설비 상태 스텝 1개가 들어 있습니다.')
    await d.find('[data-testid="se-paste-warn-cancel"]').trigger('click')
    expect(e.session.working.steps).toHaveLength(2)
    await tool(w, 'paste').trigger('click')
    await w.find('[data-paste="end"]').trigger('click')
    await w.find('[data-testid="se-paste-warn-ok"]').trigger('click')
    expect(e.session.working.steps).toHaveLength(3)
    w.unmount()
  })

  // 새 스텝 ▾ 은 스냅샷 화면의 [새 스텝] 과 같은 메뉴(NewStepMenu)를 연다(2026-11-17) — 줄마다의 규칙은 newStepMenu.test.js
  const newItem = (w, id) => w.find(`[data-testid="se-new-${id}"]`)
  it('새 스텝 ▾: 화면마다 한 줄인 메뉴를 연다 — 고른 스텝에 기준 화면이 없으면 스텝 줄이 꺼지고, 조건 없는 스텝을 누르면 시작하고 닫힌다', async () => {
    const noBase = (i) => edStep(i, { condition: { kind: 'none', skipPreprocessing: false }, images: { train: {}, base: { literal: 'AA==' } } })
    const { e } = fixture({ steps: [noBase(0), noBase(1)] })
    const w = mount(StepToolbar, { attachTo: document.body })
    await w.find('[data-testid="se-tool-new"]').trigger('click')
    expect(w.find('[data-testid="se-tool-menu"] [data-testid="se-new-menu"]').exists()).toBe(true)
    expect([off(newItem(w, 'snapshot-image')), off(newItem(w, 'step-image')), off(newItem(w, 'step-ocr')), off(newItem(w, 'file-image')), off(newItem(w, 'none'))]).toEqual([true, true, true, false, false])
    expect(w.find('[data-src="step"]').text()).toContain('이 스텝에는 기준 화면이 없습니다')
    await newItem(w, 'none').trigger('click')
    expect(e.panel).toMatchObject({ isNew: true, insertBefore: 's1', origin: 's0' }) // 고른 줄(s0) 뒤
    expect(e.panel.draft.condition.kind).toBe('none')
    expect(w.find('[data-testid="se-tool-menu"]').exists()).toBe(false)
    w.unmount()
  })

  it('새 스텝 ▾: 고른 스텝에 기준 화면이 있으면 그 스텝의 화면 줄이 켜지고, [이미지] 를 누르면 그 화면으로 잡기를 시작한다', async () => {
    const { e } = fixture()
    const w = mount(StepToolbar, { attachTo: document.body })
    await w.find('[data-testid="se-tool-new"]').trigger('click')
    expect(off(newItem(w, 'step-image'))).toBe(false)
    expect(w.find('[data-src="step"]').text()).toContain('1번 스텝의 화면')
    await newItem(w, 'step-image').trigger('click')
    expect(e.panel.draft.images.base).toEqual({ from: 'source', id: 's0-bi' })
    expect(e.capture).toMatchObject({ stage: 'area' })
    expect(w.find('[data-testid="se-tool-menu"]').exists()).toBe(false)
    w.unmount()
  })

  it('빈 시나리오(목업 조작판 20): 빌릴 화면이 없어 스텝 줄은 꺼지고(이유), 다른 시나리오에서 복사해 둔 묶음은 맨 끝에 붙인다', async () => {
    const a = fixture()
    a.e.setSelection({ uids: ['s1', 's2'], anchor: 's1' })
    a.e.copySelection(false)
    const other = (n) => ({ ...a.e.session.source, name: n })
    // 다른 시나리오 E(스텝 0)를 연다 — 묶음은 남는다
    const edited = { source: other('E'), headCrtime: 1, header: { description: '', timeoutLimit: '1' }, steps: [], property: {} }
    a.s.skeleton = { process: 'P', model: 'M', name: 'E', headCrtime: 1, version: { crtime: 1, isCurrent: true, fileId: 'F' }, steps: [], notes: [], edited }
    a.e.begin(a.s.skeleton, { canWrite: true })
    const w = mountHost()
    await tool(w, 'new').trigger('click')
    // 스텝이 없으면 빌릴 화면이 없다 — 스냅샷도 고르지 않았으니 그림 파일과 조건 없는 스텝만 켜져 있다
    expect([off(newItem(w, 'snapshot-image')), off(newItem(w, 'step-image')), off(newItem(w, 'step-ocr')), off(newItem(w, 'file-ocr')), off(newItem(w, 'none'))]).toEqual([true, true, true, false, false])
    expect(w.find('[data-src="step"]').text()).toContain('표에서 스텝을 고르면 켜집니다')
    await tool(w, 'new').trigger('click') // 닫기
    expect(off(tool(w, 'paste'))).toBe(false)
    expect(tool(w, 'paste').text()).toContain('2개')
    await tool(w, 'paste').trigger('click')
    expect(w.findAll('[data-paste]').map((b) => b.attributes('data-paste'))).toEqual(['end'])
    await w.find('[data-paste="end"]').trigger('click')
    expect(uids(a.e)).toHaveLength(2)
    expect(a.e.session.working.steps[1].next.onTrue).toStrictEqual({ kind: 'unresolved', value: 1 }) // s2 성공 → s0(묶음 밖)
    expect(a.e.session.working.steps[0].images.base.from).toBe('other')
    await tool(w, 'new').trigger('click')
    expect(off(newItem(w, 'step-image'))).toBe(false) // 붙여 온(골라진) 스텝의 기준 화면을 빌릴 수 있다
    w.unmount()
  })

  it('되돌리기·다시 하기 버튼', async () => {
    const { e } = fixture()
    const w = mountHost()
    expect([off(tool(w, 'undo')), off(tool(w, 'redo'))]).toEqual([true, true])
    e.editCell('s1', 'skip', true)
    await flushPromises()
    await tool(w, 'undo').trigger('click')
    expect(e.session.working.steps[1].condition.skipPreprocessing).toBe(false)
    expect(e.toast.text).toBe('되돌렸습니다.')
    await tool(w, 'redo').trigger('click')
    expect(e.session.working.steps[1].condition.skipPreprocessing).toBe(true)
    w.unmount()
  })

  it('읽기 전용(쓰기 권한 없음·옛 판)이면 도구 줄이 없다', () => {
    fixture({ canWrite: false })
    const a = mount(StepToolbar)
    expect(a.find('[data-testid="se-toolbar"]').exists()).toBe(false)
    a.unmount()
    setActivePinia(createPinia())
    fixture({ isCurrent: false })
    const b = mount(StepToolbar)
    expect(b.find('[data-testid="se-toolbar"]').exists()).toBe(false)
    b.unmount()
  })
})
