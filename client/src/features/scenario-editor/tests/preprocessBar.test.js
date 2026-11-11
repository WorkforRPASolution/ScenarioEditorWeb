import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ check: vi.fn(), nameRule: vi.fn(), list: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import ScenarioBar from '../components/ScenarioBar.vue'
import { useEditorStore } from '../stores/editorStore'
import { t } from '../messages'
import { windowsFromHeader } from '../editor/windows'
import { panelFixture, noneStep } from './panelFixture'

// 전처리 설정 — 시나리오 바 버튼과 저장 창 연결(P2-F 설계 §7)
const ok = (data) => Promise.resolve({ data: { success: true, data } })
const clean = (over = {}) => ({ blocks: [], warns: [], target: { exists: true, eqpCount: 3 }, conflict: null, targetExists: null, ...over })
const find = (w, id) => w.find(`[data-testid="${id}"]`)
const win = (text, className, over = {}) => ({ text, className, checkRect: false, left: -18, top: -18, right: -18, bottom: -18, ...over })
const row = (origin, text, className, over) => ({ origin, ...win(text, className, over) })
const WINDOWS = { target: { ...win('EQ Main*', 'MainFrame'), left: 0, top: 0, right: 0, bottom: 0 }, hiding: [row(0, '화면 보호기', 'Saver'), row(1, '', 'TaskWnd')] }
const W = (Text, ClassName, over = {}) => ({ Text, ClassName, IsCheckRectEqual: false, Left: -18, Top: -18, Right: -18, Bottom: -18, ...over })

function setup({ windows = WINDOWS, check = clean(), canWrite = true } = {}) {
  const f = panelFixture([noneStep(0), noneStep(1)], { canWrite })
  const edited = { ...f.edited, header: { ...f.edited.header, description: '메일', ...(windows ? { windows: JSON.parse(JSON.stringify(windows)) } : {}) } }
  const skeleton = { ...f.skeleton, id: 'P-M-N', header: { description: '메일', timeoutLimit: '1', targetWindow: null }, property: null, performance: null, edited }
  f.s.skeleton = skeleton
  f.s.scopes = { processes: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }] }] }
  f.e.begin(skeleton, f.s.me)
  api.check.mockImplementation(() => ok(check))
  api.nameRule.mockReturnValue(ok({ exists: false, rules: [] }))
  api.list.mockReturnValue(ok([]))
  const bar = mount(ScenarioBar, { attachTo: document.body })
  return { ...f, bar }
}

describe('windowsFromHeader — 편집 세션이 없을 때(뼈대만) 바가 쓰는 값', () => {
  it('뼈대 머리의 대상 창 저장값과 숨길 창 저장 목록에서 만든다', () => {
    const header = { targetWindow: { raw: W(null, 'Main'), agentFinds: false }, hidingWindows: [W('a', 'A'), W(null, null), { ...W('c', 'C'), IsCheckRectEqual: true, Left: 1, Top: 2, Right: 3, Bottom: 4 }] }
    expect(windowsFromHeader(header)).toEqual({
      target: win('', 'Main'),
      hiding: [row(0, 'a', 'A'), row(1, '', ''), row(2, 'c', 'C', { checkRect: true, left: 1, top: 2, right: 3, bottom: 4 })]
    })
  })
  it('대상 창 해석값이 없으면(새 시나리오·원본이 지워진 초안의 뼈대) null', () => {
    expect(windowsFromHeader({ targetWindow: null })).toBeNull()
    expect(windowsFromHeader(undefined)).toBeNull()
  })
})

describe('시나리오 바 — 전처리 버튼', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    document.body.innerHTML = ''
  })

  it('대상 창 상태와 숨길 창 수를 보이고, 누르면 전처리 설정 창이 열린다', async () => {
    const { bar } = setup()
    const btn = find(bar, 'se-bar-preprocess')
    expect(btn.text()).toBe('전처리: 대상 창 찾음 · 숨길 창 2')
    expect(find(bar, 'se-pp-dialog').exists()).toBe(false)
    await btn.trigger('click')
    expect(find(bar, 'se-pp-dialog').exists()).toBe(true)
    bar.unmount()
  })
  it('적용한 작업본 값을 따른다 — 확인할 줄이 있으면 수를 붙인다', async () => {
    const { bar, e } = setup()
    e.applyWindows({ target: win('EQ', ''), hiding: [...WINDOWS.hiding, row(null, 'x', ''), row(null, ' y', 'Y')] })
    await bar.vm.$nextTick()
    expect(find(bar, 'se-bar-preprocess').text()).toBe('전처리: 대상 창 찾지 않음 · 숨길 창 4 (확인 2)')
    bar.unmount()
  })
  it('편집 세션이 없으면 뼈대 저장값으로 보인다(읽기), 값을 모르면 "전처리" 만', async () => {
    const s = useEditorStore()
    s.skeleton = { process: 'P', model: 'M', name: 'N', id: 'P-M-N', version: { crtime: 1, isCurrent: true }, notes: [], steps: [], property: null, performance: null,
      header: { description: 'd', timeoutLimit: 1, targetWindow: { raw: W('EQ', 'Main'), agentFinds: true, matchMode: 'exact', reasonCode: null, inHouseShowsSet: true }, hidingWindows: [W('a', '')] } }
    const bar = mount(ScenarioBar, { attachTo: document.body })
    expect(find(bar, 'se-bar-preprocess').text()).toBe('전처리: 대상 창 찾음 · 숨길 창 1 (확인 1)')
    bar.unmount()
    setActivePinia(createPinia())
    const unknown = setup({ windows: null })
    expect(find(unknown.bar, 'se-bar-preprocess').text()).toBe('전처리')
    expect(find(unknown.bar, 'se-bar-preprocess').attributes('title')).toBe(t('SEW_PP_BAR_UNKNOWN'))
    unknown.bar.unmount()
  })
})

describe('저장 창 — 창 조건', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    sessionStorage.clear()
    document.body.innerHTML = ''
  })
  const openSave = async (bar) => { await find(bar, 'se-save').trigger('click'); await flushPromises() }

  it('바뀐 것: 대상 창은 이전 → 지금, 숨길 창은 고침·더함·지움 — 누르면 저장 창을 닫고 전처리 설정 창을 연다', async () => {
    const { bar, e } = setup()
    e.applyWindows({ target: { ...WINDOWS.target, text: 'EQ Control*' }, hiding: [{ ...WINDOWS.hiding[0], className: 'Saver2' }, row(null, 'Popup', 'Dlg')] })
    await openSave(bar)
    const rows = bar.findAll('[data-testid="se-save-change"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain(t('SEW_SAVE_CHANGE_TARGET_WINDOW'))
    expect(rows[0].text().replace(/\s+/g, ' ')).toContain('EQ Main* / MainFrame → EQ Control* / MainFrame')
    const hidingText = rows[1].text().replace(/\s+/g, ' ')
    expect(hidingText).toContain(t('SEW_SAVE_CHANGE_HIDING_WINDOWS'))
    expect(hidingText).toContain('화면 보호기 / Saver → 화면 보호기 / Saver2')
    expect(hidingText).toContain(t('SEW_SAVE_CHANGE_HIDING_ADDED', { text: 'Popup / Dlg' }))
    expect(hidingText).toContain(t('SEW_SAVE_CHANGE_HIDING_REMOVED', { text: `${t('SEW_PP_ANY_TITLE')} / TaskWnd` }))
    await rows[1].trigger('click')
    expect(find(bar, 'se-save-dialog').exists()).toBe(false)
    expect(find(bar, 'se-pp-dialog').exists()).toBe(true)
    bar.unmount()
  })
  it('검사 줄(숨길 창 클래스 없음)을 누르면 전처리 설정 창이 그 줄을 골라 열린다', async () => {
    const block = { code: 'HIDING_CLASS_EMPTY', params: { which: 'hiding:1', no: 2 } }
    const { bar } = setup({ check: clean({ blocks: [block] }) })
    await openSave(bar)
    const issue = bar.findAll('[data-testid="se-save-issue"]').find((r) => r.text().includes(t('RULE_HIDING_CLASS_EMPTY', { no: 2 })))
    expect(issue).toBeTruthy()
    await issue.trigger('click')
    expect(find(bar, 'se-save-dialog').exists()).toBe(false)
    expect(find(bar, 'se-pp-dialog').exists()).toBe(true)
    await bar.vm.$nextTick()
    expect(bar.find('tr[data-row="1"]').classes()).toContain('sel')
    bar.unmount()
  })
})
