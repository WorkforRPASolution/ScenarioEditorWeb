import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => `http://x/api${p}` }))
import { newAction, withCodes, actionBlocked, changedFields, numIn, firstError, trainMapDropped, keyboardTokensDropped } from '../editor/panel'
import { checkStepFields } from '../editor/fieldRules'
import ActionStation from '../components/panel/ActionStation.vue'
import KeyboardAction from '../components/panel/actions/KeyboardAction.vue'
import CustomScriptAction from '../components/panel/actions/CustomScriptAction.vue'
import WheelAction from '../components/panel/actions/WheelAction.vue'
import WaitAction from '../components/panel/actions/WaitAction.vue'
import FindWindowAction from '../components/panel/actions/FindWindowAction.vue'
import CommandAction from '../components/panel/actions/CommandAction.vue'
import ClickAction from '../components/panel/actions/ClickAction.vue'
import KeptAction from '../components/panel/actions/KeptAction.vue'
import { t, MESSAGES } from '../messages'
import { panelFixture, imageStep, ocrStep, noneStep } from './panelFixture'

const last = (w) => { const ev = w.emitted('update'); return ev[ev.length - 1][0] }
const set = async (el, value) => { el.element.value = value; await el.trigger('input'); await el.trigger('change') }

describe('editor/panel — 순수 함수', () => {
  it('newAction: 종류별 기본값(parseAction 모양), 클릭끼리는 좌표를 지키고, 원래 종류로 돌아오면 원래 값', () => {
    const d = imageStep(0)
    expect(newAction(4, d, d)).toEqual({ type: 4, typeName: 'MouseMove', wheel: { notches: 3, delaySec: 1 } })
    expect(newAction(5, d, d)).toEqual({ type: 5, typeName: 'Keyboard', keyboard: { text: '', keys: [], unknownCodes: [], codes: [] } })
    expect(newAction(6, d, d)).toEqual({ type: 6, typeName: 'Wait', waitSec: 5 })
    expect(newAction(9, d, d)).toEqual({ type: 9, typeName: 'FindWindow', findWindow: { title: '', className: '', x: null, y: null } })
    expect(newAction(11, d, d)).toEqual({ type: 11, typeName: 'RunCommand', command: '' })
    expect(newAction(12, d, d)).toEqual({ type: 12, typeName: 'CustomScript', customScript: { name: '', args: [], timeout: null, email: [], legacy: false } })
    expect(newAction(0, d, d)).toEqual({ type: 0, typeName: 'None' })
    expect(newAction(10, d, d)).toEqual({ type: 10, typeName: 'SendEmail' })
    expect(newAction(2, d, d)).toEqual({ type: 2, typeName: 'MouseLeftDoubleClick', click: { x: 24, y: 12, basis: 'trainImage' } })
    const moved = { ...d, action: { type: 3, typeName: 'MouseRightClick', click: { x: 7, y: 8, basis: 'trainImage' } } }
    expect(newAction(1, moved, d).click).toEqual({ x: 7, y: 8, basis: 'trainImage' })
    const waited = { ...d, action: newAction(6, d, d) }
    expect(newAction(1, waited, d)).toBe(d.action) // 원래 종류 = 원래 값(같은 객체)
    expect(newAction(1, { ...waited }, { ...d, action: { type: 6 } })).toEqual({ type: 1, typeName: 'MouseLeftClick', click: { x: null, y: null, basis: 'trainImage' } })
  })
  it('withCodes: 키 코드 목록(누르는 순서)을 바꾸고 보여 주기용 keys·unknownCodes 를 다시 만든다', () => {
    const k = { text: 'a', keys: [{ code: 9, name: 'Tab' }], unknownCodes: [999], codes: [9, 999] }
    expect(withCodes(k, [9, 999, 10])).toEqual({ text: 'a', codes: [9, 999, 10], keys: [{ code: 9, name: 'Tab' }, { code: 10, name: 'Enter' }], unknownCodes: [999] })
  })
  it('actionBlocked: OCR·조건 없음·설비 상태에서 마우스 클릭 셋, 다중 검사 2개 이상이면 없음 밖 전부', () => {
    expect(actionBlocked(1, { kind: 'ocr' })).toBe('SEW_PANEL_CLICK_BLOCKED_ocr')
    expect(actionBlocked(3, { kind: 'none' })).toBe('SEW_PANEL_CLICK_BLOCKED_none')
    expect(actionBlocked(2, { kind: 'eqpState' })).toBe('SEW_PANEL_CLICK_BLOCKED_eqpState')
    expect(actionBlocked(4, { kind: 'ocr' })).toBe(null)
    expect(actionBlocked(1, { kind: 'image', image: { multi: { count: '1', op: 0 } } })).toBe(null)
    expect(actionBlocked(1, { kind: 'image', image: { multi: { count: '2', op: 0 } } })).toBe('SEW_PANEL_MULTI_NO_ACTION')
    expect(actionBlocked(0, { kind: 'image', image: { multi: { count: '2', op: 0 } } })).toBe(null)
  })
  it('changedFields: 바뀐 칸 묶음', () => {
    const a = imageStep(0)
    expect(changedFields(a, a)).toEqual([])
    const b = { ...a, descriptionToEmail: 'x', condition: { ...a.condition, image: { ...a.condition.image, accept: 0.8 } }, next: { ...a.next, onFalse: { kind: 'next' } } }
    expect(changedFields(a, b)).toEqual(['desc', 'accept', 'onFalse'])
    expect(changedFields(a, { ...a, isShowDialog: false })).toEqual(['other'])
  })
  it('numIn: 빈 칸은 null, 숫자면 숫자, 아니면 친 글자 그대로(칸 검사가 잡는다)', () => {
    expect([numIn(''), numIn(' 3 '), numIn('0.5'), numIn('1a')]).toEqual([null, 3, 0.5, '1a'])
  })
  it('firstError: 레일 순서로 첫 오류 칸(안내는 막지 않는다)', () => {
    expect(firstError({ retry: { level: 'error' }, desc: { level: 'error' } })).toBe('desc')
    expect(firstError({ action: { level: 'notice' } })).toBe(null)
    expect(firstError({ onTrue: { level: 'error' }, click: { level: 'error' } })).toBe('click')
  })
  it('trainMapDropped·keyboardTokensDropped: 저장 값의 키·값만 본다', () => {
    const sk = (m) => ({ raw: { Metadata: { ImageSearchParam: { TrainImageMap: m } } } })
    expect(trainMapDropped(sk({ 0: {}, 1: {} }))).toBe(false)
    expect(trainMapDropped(sk({ 0: {}, '-1': {} }))).toBe(true)
    expect(trainMapDropped(sk({ '01': {} }))).toBe(true)
    expect(trainMapDropped(sk({ 0: null }))).toBe(true)
    expect(trainMapDropped({ raw: {} })).toBe(false)
    expect(trainMapDropped(null)).toBe(false)
    expect(keyboardTokensDropped({ notes: [{ code: 'PARSE_FAILED', params: { field: 'keyboard' } }] })).toBe(true)
    expect(keyboardTokensDropped({ notes: [{ code: 'PARSE_FAILED', params: { field: 'wheel' } }] })).toBe(false)
  })
})

describe('동작별 입력', () => {
  it('키보드: 글자를 고치고, 기능 키를 누르면 순서 끝에 더하고, 넣은 키를 누르면 뺀다 — codes 를 고친다', async () => {
    const action = { type: 5, typeName: 'Keyboard', raw: 'admin@@9', keyboard: { text: 'admin', keys: [{ code: 9, name: 'Tab' }], unknownCodes: [], codes: [9] } }
    const w = mount(KeyboardAction, { props: { action, errs: {} } })
    await set(w.find('[data-field="key"]'), 'root')
    expect(last(w).keyboard).toMatchObject({ text: 'root', codes: [9] })
    await w.find('[data-key-add="10"]').trigger('click')
    expect(last(w).keyboard).toMatchObject({ text: 'admin', codes: [9, 10], keys: [{ code: 9, name: 'Tab' }, { code: 10, name: 'Enter' }] })
    expect(last(w).raw).toBe('admin@@9') // 저장 값은 서버가 다시 만든다(브라우저는 문자열을 만들지 않는다)
    await w.find('[data-key-del="0"]').trigger('click')
    expect(last(w).keyboard.codes).toEqual([])
  })
  it('키보드: 기능 키는 10개까지', () => {
    const codes = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
    const w = mount(KeyboardAction, { props: { action: { type: 5, keyboard: withCodes({ text: '' }, codes) }, errs: {} } })
    expect(w.find('[data-key-add="9"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain(t('SEW_PANEL_KEY_FUNC_HINT', { n: 10 }))
  })
  it('사용자 스크립트: 이름·인자·시간 제한(값·단위)·결과 메일', async () => {
    const action = { type: 12, typeName: 'CustomScript', raw: 'run;a', customScript: { name: 'run', args: ['a'], timeout: { value: 5, unit: 'minutes' }, email: [], legacy: false } }
    const w = mount(CustomScriptAction, { props: { action, errs: {} } })
    await w.find('[data-testid="se-cs-timeout-unit"]').setValue('hours')
    expect(last(w).customScript.timeout).toEqual({ value: 5, unit: 'hours' })
    await set(w.find('[data-testid="se-cs-timeout-value"]'), '2')
    expect(last(w).customScript.timeout).toEqual({ value: 2, unit: 'minutes' })
    await set(w.find('[data-field="script"]'), 'job')
    expect(last(w).customScript.name).toBe('job')
    await set(w.find('[data-cs-arg="0"]'), 'b')
    expect(last(w).customScript.args).toEqual(['b'])
    await w.find('[data-testid="se-cs-arg-add"]').trigger('click')
    expect(last(w).customScript.args).toEqual(['a', ''])
    await w.find('[data-cs-arg-del="0"]').trigger('click')
    expect(last(w).customScript.args).toEqual([])
    const box = w.find('[data-cs-email="fail"]'); box.element.checked = true; await box.trigger('change')
    expect(last(w).customScript.email).toEqual(['fail'])
    const on = w.find('[data-testid="se-cs-timeout-on"]'); on.element.checked = false; await on.trigger('change')
    expect(last(w).customScript.timeout).toBe(null)
  })
  it('사용자 스크립트: 시간 제한이 없으면 켜서 넣는다', async () => {
    const w = mount(CustomScriptAction, { props: { action: { type: 12, customScript: { name: 'x', args: [], timeout: null, email: [], legacy: false } }, errs: {} } })
    expect(w.find('[data-testid="se-cs-timeout-unit"]').exists()).toBe(false)
    const on = w.find('[data-testid="se-cs-timeout-on"]'); on.element.checked = true; await on.trigger('change')
    expect(last(w).customScript.timeout).toEqual({ value: 1, unit: 'minutes' })
  })
  it('휠: 방향(위로 = 음수)·칸 수·대기 초', async () => {
    const w = mount(WheelAction, { props: { action: { type: 4, wheel: { notches: 3, delaySec: 1 } }, errs: {} } })
    await w.find('[data-wheel-dir="up"]').trigger('click')
    expect(last(w).wheel).toEqual({ notches: -3, delaySec: 1 })
    await set(w.find('[data-field="wheel"]'), '5')
    expect(last(w).wheel).toEqual({ notches: 5, delaySec: 1 })
    await set(w.find('[data-testid="se-wheel-delay"]'), '2')
    expect(last(w).wheel).toEqual({ notches: 3, delaySec: 2 })
    const up = mount(WheelAction, { props: { action: { type: 4, wheel: { notches: -4, delaySec: 0 } }, errs: {} } })
    expect(up.find('[data-field="wheel"]').element.value).toBe('4')
    expect(up.find('[data-wheel-dir="up"]').attributes('aria-pressed')).toBe('true')
  })
  it('대기: 초', async () => {
    const w = mount(WaitAction, { props: { action: { type: 6, waitSec: 5 }, errs: {} } })
    expect(w.find('[data-field="wait"]').element.value).toBe('5')
    await set(w.find('[data-field="wait"]'), '90')
    expect(last(w).waitSec).toBe(90)
    const long = mount(WaitAction, { props: { action: { type: 6, waitSec: 90 }, errs: {} } })
    expect(long.text()).toContain(t('SEW_PANEL_WAIT_MIN', { m: 1, s: 30 }))
  })
  it('창 찾기: 이름·클래스·X·Y(비우면 null)', async () => {
    const w = mount(FindWindowAction, { props: { action: { type: 9, findWindow: { title: 'A', className: 'B', x: 1, y: 2 } }, errs: {} } })
    await set(w.find('[data-field="fw"]'), 'Alarm')
    expect(last(w).findWindow).toEqual({ title: 'Alarm', className: 'B', x: 1, y: 2 })
    await set(w.find('[data-testid="se-fw-x"]'), '')
    expect(last(w).findWindow.x).toBe(null)
    await set(w.find('[data-testid="se-fw-class"]'), '#32770')
    expect(last(w).findWindow.className).toBe('#32770')
  })
  it('명령: 한 줄', async () => {
    const w = mount(CommandAction, { props: { action: { type: 11, command: 'a.bat' }, errs: {} } })
    await set(w.find('[data-field="cmd"]'), 'b.bat')
    expect(last(w).command).toBe('b.bat')
  })
  it('클릭(이미지 스텝): 찾은 그림 왼쪽 위 기준 X·Y', async () => {
    const w = mount(ClickAction, { props: { action: { type: 1, click: { x: 24, y: 12, basis: 'trainImage' } }, errs: {}, kind: 'image' } })
    await set(w.find('[data-field="click"]'), '30')
    expect(last(w).click).toEqual({ x: 30, y: 12, basis: 'trainImage' })
    await set(w.find('[data-testid="se-click-y"]'), '')
    expect(last(w).click.y).toBe(null)
    expect(w.text()).toContain(t('SEW_PANEL_CLICK_HELP'))
  })
  it('클릭(OCR·조건 없음 옛 값): 입력 없이 값만', () => {
    const w = mount(ClickAction, { props: { action: { type: 1, click: { x: 5, y: 6, basis: 'screenOrigin' } }, errs: {}, kind: 'none' } })
    expect(w.findAll('input').length).toBe(0)
    expect(w.text()).toContain(t('SEW_PANEL_CLICK_NONE_HELP'))
  })
  it('보존 전용(ACS 등): 원래 값과 "고칠 수 없음", 입력 없음', () => {
    const w = mount(KeptAction, { props: { action: { type: 14, typeName: 'ACS', raw: 'CALL PM' } } })
    expect(w.findAll('input, select, textarea').length).toBe(0)
    expect(w.text()).toContain('CALL PM')
    expect(w.text()).toContain(t('SEW_PANEL_LOCKED_HELP'))
  })
})

describe('ActionStation — 동작 고르기', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const mountStation = (e) => mount(ActionStation, { props: { draft: e.panel.draft, errs: {} } })
  const tile = (w, type) => w.find(`[data-act="${type}"]`)

  it('OCR 스텝은 마우스 클릭 셋을 고를 수 없고 이유를 보인다', async () => {
    const { e } = panelFixture([ocrStep(0)])
    const w = mountStation(e)
    await w.find('[data-testid="se-panel-act-now"]').trigger('click')
    for (const type of [1, 2, 3]) expect(tile(w, type).attributes('disabled')).toBeDefined()
    for (const type of [0, 4, 5, 6, 9, 10, 11, 12]) expect(tile(w, type).attributes('disabled')).toBeUndefined()
    expect(w.find('[data-testid="se-panel-act-why"]').text()).toBe(MESSAGES.SEW_PANEL_CLICK_BLOCKED_ocr)
    expect(tile(w, 1).attributes('title')).toBe(MESSAGES.SEW_PANEL_CLICK_BLOCKED_ocr)
  })
  it('조건 없음도 클릭 셋을 막는다, 보존 전용 동작은 목록에 없다', async () => {
    const { e } = panelFixture([noneStep(0)])
    const w = mountStation(e)
    await w.find('[data-testid="se-panel-act-now"]').trigger('click')
    expect(tile(w, 1).attributes('disabled')).toBeDefined()
    for (const type of [7, 8, 13, 14, 15]) expect(tile(w, type).exists()).toBe(false)
  })
  it('종류를 고르면 초안 동작이 그 종류 기본값이 되고 목록이 닫힌다', async () => {
    const { e, edited } = panelFixture([imageStep(0)])
    const w = mountStation(e)
    await w.find('[data-testid="se-panel-act-now"]').trigger('click')
    await tile(w, 12).trigger('click')
    expect(e.panel.draft.action).toEqual({ type: 12, typeName: 'CustomScript', customScript: { name: '', args: [], timeout: null, email: [], legacy: false } })
    expect(e.session.working).toBe(edited)
    expect(tile(w, 12).exists()).toBe(false)
  })
  it('다중 검사가 2개 이상이면 없음 밖은 고를 수 없다', async () => {
    const { e } = panelFixture([imageStep(0, { action: { type: 0, typeName: 'None', raw: '' }, condition: { ...imageStep(0).condition, image: { ...imageStep(0).condition.image, multi: { count: '3', op: 1, raw: '3-1' } } } })])
    const w = mountStation(e)
    await w.find('[data-testid="se-panel-act-now"]').trigger('click')
    expect(tile(w, 0).attributes('disabled')).toBeUndefined()
    expect(tile(w, 4).attributes('title')).toBe(MESSAGES.SEW_PANEL_MULTI_NO_ACTION)
  })
  it('사용자 스크립트 시간 제한 단위를 바꾸면 초안의 customScript.timeout.unit 이 바뀐다', async () => {
    const cs = { type: 12, typeName: 'CustomScript', raw: 'run;@@timeout:5 minutes', customScript: { name: 'run', args: [], timeout: { value: 5, unit: 'minutes' }, email: [], legacy: false } }
    const { e } = panelFixture([noneStep(0, { action: cs })])
    const w = mountStation(e)
    await w.find('[data-testid="se-cs-timeout-unit"]').setValue('seconds')
    expect(e.panel.draft.action.customScript.timeout.unit).toBe('seconds')
    expect(checkStepFields(e.panel.draft, { working: e.session.working }).script).toBeUndefined()
  })
  it('보존 전용(ACS) 동작은 입력이 없다', () => {
    const { e } = panelFixture([noneStep(0, { action: { type: 14, typeName: 'ACS', raw: 'CALL PM TEAM' } })])
    const w = mountStation(e)
    expect(w.find('[data-testid="se-panel-act-body"]').findAll('input, select, textarea').length).toBe(0)
  })
})
