import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => p }))
import PreprocessDialog from '../components/PreprocessDialog.vue'
import { useEditorStore } from '../stores/editorStore'
import { t } from '../messages'
import { panelFixture, noneStep } from './panelFixture'

// 전처리 설정 창(P2-F 설계 §7, 목업 2026-11-11-preprocessing-v1 의 상황 6가지). 창은 실제 Teleport 로 body 에 그린다(propertyDialog.test 와 같다).
const q = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? new DOMWrapper(el) : { exists: () => false } }
const qa = (sel) => [...document.querySelectorAll(sel)].map((el) => new DOMWrapper(el))
const rows = () => qa('[data-testid="se-pp-dialog"] tr[data-row]')
const rowText = (i) => rows()[i].text()
const win = (text, className, over = {}) => ({ text, className, checkRect: false, left: -18, top: -18, right: -18, bottom: -18, ...over })
const row = (origin, text, className, over) => ({ origin, ...win(text, className, over) })
const NORMAL = {
  target: { text: 'EQ Main Control*', className: 'WindowsForms10', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 },
  hiding: [row(0, '화면 보호기', 'ScreenSaverClass'), row(1, '', 'TaskManagerWindow'), row(2, 'Alarm Popup*', '#32770', { checkRect: true, left: 100, top: 100, right: 500, bottom: 400 })]
}
const OLD = { target: { ...win('*', 'MainFrame'), left: 0, top: 0, right: 0, bottom: 0 }, hiding: [row(0, 'Notice', ''), row(1, '  Popup* ', 'Dialog'), row(2, 'Legacy', 'LegacyWnd', { checkRect: true, left: -218, top: 0, right: 0, bottom: 0 })] }
const clone = (v) => JSON.parse(JSON.stringify(v))

let w = null
function setup(windows = NORMAL, { canWrite = true, isCurrent = true, sop = null, clip = null, props = {} } = {}) {
  const f = panelFixture([noneStep(0)], { canWrite, isCurrent })
  const header = { ...f.edited.header, ...(windows ? { windows: clone(windows) } : {}) }
  const skeleton = { ...f.skeleton, id: 'P-M-N', header: {}, edited: { ...f.edited, header } }
  f.s.skeleton = skeleton
  f.e.begin(skeleton, f.s.me)
  useEditorStore().links = { preprocessingSop: sop }
  if (clip) f.e.copyWindows(clip)
  w = mount(PreprocessDialog, { props: { modelValue: true, ...props }, attachTo: document.body })
  return { ...f, w }
}
const closed = () => (w.emitted('update:modelValue') ?? []).some((a) => a[0] === false)
const now = (e) => e.session.working.header.windows

describe('PreprocessDialog', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = '' })

  it('보통: 대상 창과 숨길 창이 보이고, 줄마다 실행 때 찾는지 알린다', async () => {
    setup()
    await nextTick()
    expect(q('se-pp-target-text').element.value).toBe('EQ Main Control*')
    expect(q('se-pp-target-class').element.value).toBe('WindowsForms10')
    expect(q('se-pp-target-state').attributes('data-level')).toBe('ok')
    expect(q('se-pp-target-state').text()).toBe(t('SEW_PP_TARGET_OK_partial', { text: 'EQ Main Control' }))
    expect(q('se-pp-count').text()).toBe('3 / 20')
    expect(rows()).toHaveLength(3)
    expect(rowText(0)).toContain('화면 보호기')
    expect(rowText(0)).toContain(t('SEW_PP_STATE_FOUND'))
    expect(rowText(1)).toContain(t('SEW_PP_ANY_TITLE'))
    expect(rowText(1)).toContain(t('SEW_PP_STATE_ANY_TITLE'))
    expect(rowText(2)).toContain('100, 100, 500, 400')
    expect(q('se-pp-apply').attributes('disabled')).toBeDefined() // 바꾼 것이 없다
    expect(q('se-pp-foot').text()).toContain(t('SEW_PP_FOOT_SAME'))
    expect(q('se-pp-sop').exists()).toBe(false)
  })

  it('대상 창: 치는 대로 상태 줄이 바뀌고, [적용] 하면 앞뒤 공백을 지워 작업본에 넣는다 — 고치지 않은 숨길 창은 그대로', async () => {
    const { e } = setup()
    await q('se-pp-target-class').setValue('')
    expect(q('se-pp-target-state').attributes('data-level')).toBe('warn')
    expect(q('se-pp-target-state').text()).toBe(t('SEW_PP_TARGET_WARN', { reason: t('SEW_UI_TW_REASON_CLASS_EMPTY') }))
    await q('se-pp-target-text').setValue('')
    expect(q('se-pp-target-state').attributes('data-level')).toBe('none')
    await q('se-pp-target-text').setValue('  EQ Main ')
    await q('se-pp-target-class').setValue('MainFrame ')
    expect(q('se-pp-target-state').text()).toBe(t('SEW_PP_TARGET_OK_exact', { text: 'EQ Main' }))
    expect(q('se-pp-apply').attributes('disabled')).toBeUndefined()
    await q('se-pp-apply').trigger('click')
    expect(now(e).target).toEqual({ text: 'EQ Main', className: 'MainFrame', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 })
    expect(now(e).hiding).toEqual(NORMAL.hiding)
    expect(closed()).toBe(true)
    expect(JSON.stringify(e.toast)).toContain(t('SEW_PP_APPLIED'))
  })

  it('대상 창 위치 값은 접혀 있고, 위치 확인을 끄면 좌표가 -18 이 되고 잠긴다 — 정수가 아니면 적용할 수 없다', async () => {
    const { e } = setup()
    expect(q('se-pp-target-more').element.open).toBe(false)
    await q('se-pp-target-check').setValue(true)
    expect(q('se-pp-target-coord-0').attributes('disabled')).toBeUndefined()
    await q('se-pp-target-coord-2').setValue('80o')
    expect(q('se-pp-target-error').text()).toBe(t('SEW_PP_ERR_COORD'))
    expect(q('se-pp-apply').attributes('disabled')).toBeDefined()
    await q('se-pp-target-coord-2').setValue('800')
    await q('se-pp-apply').trigger('click')
    expect(now(e).target).toMatchObject({ checkRect: true, left: 0, top: 0, right: 800, bottom: 0 })
  })
  it('대상 창 위치 확인을 끄면 -18', async () => {
    const { e } = setup({ ...NORMAL, target: { ...NORMAL.target, checkRect: true, left: 1, top: 2, right: 3, bottom: 4 } })
    await q('se-pp-target-check').setValue(false)
    expect(q('se-pp-target-coord-0').element.value).toBe('-18')
    expect(q('se-pp-target-coord-0').attributes('disabled')).toBeDefined()
    await q('se-pp-apply').trigger('click')
    expect(now(e).target).toMatchObject({ checkRect: false, left: -18, top: -18, right: -18, bottom: -18 })
  })

  it('숨길 창 추가: 클래스가 없으면 그 자리에서 막고, 넣으면 새 줄(공백을 지운 값)이 된다', async () => {
    const { e } = setup()
    await q('se-pp-add').trigger('click')
    await q('se-pp-add-text').setValue(' Notice ')
    await q('se-pp-add-ok').trigger('click')
    expect(q('se-pp-add-error').text()).toBe(t('SEW_PP_ERR_CLASS'))
    expect(rows()).toHaveLength(3)
    await q('se-pp-add-class').setValue(' NoticeWnd ')
    await q('se-pp-add-check').setValue(true)
    for (const [i, v] of ['0', '0', '800', '60x'].entries()) await q(`se-pp-add-coord-${i}`).setValue(v)
    await q('se-pp-add-ok').trigger('click')
    expect(q('se-pp-add-error').text()).toBe(t('SEW_PP_ERR_COORD'))
    await q('se-pp-add-coord-3').setValue('600')
    await q('se-pp-add-ok').trigger('click')
    expect(q('se-pp-add-text').exists()).toBe(false)
    expect(rows()).toHaveLength(4)
    expect(rowText(3)).toContain(t('SEW_PP_NEW'))
    expect(q('se-pp-count').text()).toBe('4 / 20')
    await q('se-pp-apply').trigger('click')
    expect(now(e).hiding[3]).toEqual({ origin: null, text: 'Notice', className: 'NoticeWnd', checkRect: true, left: 0, top: 0, right: 800, bottom: 600 })
  })
  it('같은 조건의 숨길 창은 넣을 수 없다', async () => {
    setup()
    await q('se-pp-add').trigger('click')
    await q('se-pp-add-text').setValue('화면 보호기')
    await q('se-pp-add-class').setValue('ScreenSaverClass')
    await q('se-pp-add-ok').trigger('click')
    expect(q('se-pp-add-error').text()).toBe(t('SEW_PP_ERR_SAME'))
    await q('se-pp-add-cancel').trigger('click')
    expect(rows()).toHaveLength(3)
    expect(q('se-pp-apply').attributes('disabled')).toBeDefined()
  })

  it('숨길 창을 줄에서 고치고 지운다 — 고치는 동안에는 적용할 수 없다, origin 은 그대로', async () => {
    const { e } = setup()
    await rows()[0].find('[data-testid="se-pp-row-edit"]').trigger('click')
    await q('se-pp-edit-class').setValue('ScreenSaver2')
    expect(q('se-pp-apply').attributes('disabled')).toBeDefined()
    expect(q('se-pp-foot').text()).toContain(t('SEW_PP_FOOT_EDITING'))
    await q('se-pp-edit-ok').trigger('click')
    expect(rowText(0)).toContain('ScreenSaver2')
    await rows()[1].find('[data-testid="se-pp-row-delete"]').trigger('click')
    expect(rows()).toHaveLength(2)
    await q('se-pp-apply').trigger('click')
    expect(now(e).hiding).toEqual([row(0, '화면 보호기', 'ScreenSaver2'), NORMAL.hiding[2]])
  })
  it('고치다가 클래스를 지우면 확인할 수 없고, [취소] 하면 원래 값이다. 위치 확인을 끄면 -18', async () => {
    const { e } = setup()
    await rows()[2].find('[data-testid="se-pp-row-edit"]').trigger('click')
    await q('se-pp-edit-class').setValue('')
    await q('se-pp-edit-ok').trigger('click')
    expect(q('se-pp-edit-error').text()).toBe(t('SEW_PP_ERR_CLASS'))
    await q('se-pp-edit-cancel').trigger('click')
    expect(rowText(2)).toContain('#32770')
    await rows()[2].find('[data-testid="se-pp-row-edit"]').trigger('click')
    await q('se-pp-edit-check').setValue(false)
    expect(q('se-pp-edit-coord-0').element.value).toBe('-18')
    await q('se-pp-edit-ok').trigger('click')
    await q('se-pp-apply').trigger('click')
    expect(now(e).hiding[2]).toEqual(row(2, 'Alarm Popup*', '#32770'))
  })

  it('옛 값에 문제: 줄마다 이유를 보이지만 고치지 않은 줄 때문에 적용을 막지 않는다', async () => {
    const { e } = setup(OLD)
    await nextTick()
    expect(q('se-pp-target-state').text()).toBe(t('SEW_PP_TARGET_WARN', { reason: t('SEW_UI_TW_REASON_TEXT_STAR') }))
    expect(rowText(0)).toContain(t('SEW_PP_STATE_CLASS_EMPTY'))
    expect(rowText(0)).toContain(t('SEW_PP_NO_CLASS'))
    expect(rowText(1)).toContain(t('SEW_PP_STATE_SPACE'))
    expect(rowText(2)).toContain(t('SEW_PP_STATE_FIXED_SIZE'))
    await q('se-pp-add').trigger('click')
    await q('se-pp-add-class').setValue('OkWnd')
    await q('se-pp-add-ok').trigger('click')
    await q('se-pp-apply').trigger('click')
    expect(now(e).hiding).toEqual([...OLD.hiding, row(null, '', 'OkWnd')])
    expect(now(e).target).toEqual(OLD.target)
  })

  it('복사·붙여넣기: 고른 줄(없으면 전체)을 복사하고, 붙일 때 같은 조건은 건너뛴다', async () => {
    const { e } = setup(NORMAL, { clip: [win('Windows Update', 'UpdateDlg'), win('화면 보호기', 'ScreenSaverClass'), win('', 'NotifyWnd')] })
    expect(q('se-pp-paste').text()).toBe(t('SEW_PP_PASTE_N', { n: 3 }))
    await q('se-pp-paste').trigger('click')
    expect(rows()).toHaveLength(5)
    expect(JSON.stringify(e.toast)).toContain(t('SEW_PP_PASTED', { n: 2 }))
    expect(JSON.stringify(e.toast)).toContain(t('SEW_PP_PASTED_SAME', { n: 1 }))
    expect(q('se-pp-copy').text()).toBe(t('SEW_PP_COPY_ALL'))
    await rows()[1].trigger('click')
    expect(rows()[1].classes()).toContain('sel')
    expect(q('se-pp-copy').text()).toBe(t('SEW_PP_COPY_SEL'))
    await q('se-pp-copy').trigger('click')
    expect(e.windowClip).toEqual([win('', 'TaskManagerWindow')])
    await rows()[1].trigger('click') // 다시 누르면 고르기를 푼다
    await q('se-pp-copy').trigger('click')
    expect(e.windowClip).toHaveLength(5)
  })

  it('한도 20개: 추가·붙여넣기가 꺼지고 안내가 보인다', async () => {
    const many = { target: NORMAL.target, hiding: Array.from({ length: 20 }, (_, i) => row(i, 'Popup ' + i, 'Dialog' + i)) }
    setup(many, { clip: [win('x', 'X')] })
    await nextTick()
    expect(q('se-pp-count').text()).toBe('20 / 20')
    expect(q('se-pp-add').attributes('disabled')).toBeDefined()
    expect(q('se-pp-paste').attributes('disabled')).toBeDefined()
    expect(q('se-pp-limit').text()).toBe(t('SEW_PP_LIMIT', { limit: 20 }))
  })

  it('새 시나리오처럼 비어 있으면 빈 안내와 추가만', async () => {
    setup({ target: { text: '', className: '', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 }, hiding: [] })
    await nextTick()
    expect(q('se-pp-target-state').text()).toBe(t('SEW_PP_TARGET_NONE'))
    expect(q('se-pp-empty').text()).toBe(t('SEW_PP_EMPTY'))
    expect(q('se-pp-copy').attributes('disabled')).toBeDefined()
    expect(q('se-pp-paste').attributes('disabled')).toBeDefined()
  })

  it.each([['쓰기 권한 없음', { canWrite: false }], ['옛 버전', { isCurrent: false }]])('읽기 전용(%s): 값을 볼 수만 있고 [닫기] 만 있다', async (_, opts) => {
    const { e } = setup(NORMAL, opts)
    await nextTick()
    expect(q('se-pp-readonly').text()).toBe(t('SEW_PP_READONLY'))
    expect(q('se-pp-target-text').attributes('disabled')).toBeDefined()
    expect(rows()).toHaveLength(3)
    for (const id of ['se-pp-add', 'se-pp-copy', 'se-pp-paste', 'se-pp-apply', 'se-pp-cancel', 'se-pp-row-edit', 'se-pp-row-delete']) expect(q(id).exists(), id).toBe(false)
    await q('se-pp-close').trigger('click')
    expect(closed()).toBe(true)
    expect(now(e)).toEqual(NORMAL)
  })
  it('창 조건을 알 수 없는 세션(원본이 지워진 옛 초안)은 읽기 전용이고 알 수 없다고 알린다', async () => {
    setup(null)
    await nextTick()
    expect(q('se-pp-readonly').text()).toBe(t('SEW_PP_BAR_UNKNOWN'))
    expect(q('se-pp-apply').exists()).toBe(false)
  })

  it('닫기: 바꾼 것이 없으면 바로 닫고, 있으면 묻는다 — [계속 고치기]는 남고 [버리고 닫기]는 작업본을 그대로 둔다', async () => {
    const { e } = setup()
    await q('se-pp-cancel').trigger('click')
    expect(closed()).toBe(true)
    w.unmount(); document.body.innerHTML = ''
    setActivePinia(createPinia())
    const b = setup()
    await rows()[0].find('[data-testid="se-pp-row-delete"]').trigger('click')
    await q('se-pp-cancel').trigger('click')
    expect(q('se-pp-leave').text()).toContain(t('SEW_PP_DISCARD'))
    expect(closed()).toBe(false)
    await q('se-pp-leave-keep').trigger('click')
    expect(q('se-pp-leave').exists()).toBe(false)
    expect(rows()).toHaveLength(2)
    await q('se-pp-cancel').trigger('click')
    await q('se-pp-leave-drop').trigger('click')
    expect(closed()).toBe(true)
    expect(now(b.e)).toEqual(NORMAL)
    expect(now(e)).toEqual(NORMAL)
  })

  it('안내 문서 링크는 설정값이 있을 때만 새 탭으로 보인다', async () => {
    setup(NORMAL, { sop: 'https://wiki.example.com/sop' })
    await nextTick()
    const a = q('se-pp-sop')
    expect(a.attributes('href')).toBe('https://wiki.example.com/sop')
    expect(a.attributes('target')).toBe('_blank')
    expect(a.attributes('rel')).toContain('noopener')
  })

  it('저장 창의 검사 줄에서 오면 그 숨길 창 줄을 고른다', async () => {
    setup(NORMAL, { props: { focus: { which: 'hiding:2', n: 1 } } })
    await nextTick()
    expect(rows()[2].classes()).toContain('sel')
  })

  it('다시 열면 작업본 값에서 새로 시작한다(닫기 전에 넣던 줄·고르기는 남지 않는다)', async () => {
    setup()
    await rows()[0].find('[data-testid="se-pp-row-delete"]').trigger('click')
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true })
    expect(rows()).toHaveLength(3)
  })
})
