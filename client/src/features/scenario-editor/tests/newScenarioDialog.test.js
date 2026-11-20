import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ list: vi.fn(), listDrafts: vi.fn(), nameRule: vi.fn(), open: vi.fn(), saveDraft: vi.fn(), check: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import NewScenarioDialog from '../components/NewScenarioDialog.vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { t, MESSAGES } from '../messages'
import { formatCrtime } from '../format'
import { DEFAULT_TIMEOUT, defaultProperty, newScenarioOf, checkNewScenario, newName, issueKey } from '../editor/newScenario'
import { nameRuleOf } from '../editor/nameRule'
import { panelFixture, noneStep } from './panelFixture'

const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code) => Promise.reject({ response: { status, data: { code } }, request: {} })
const RULE_RES = {
  exists: true,
  rules: [
    { groupLevel: 1, name: 'ALARM', description: '알람' }, { groupLevel: 1, name: 'AUTO', description: '자동 실행' },
    { groupLevel: 2, name: 'RECOVERY', description: '복구' }, { groupLevel: 2, name: 'DATABACKUP', description: '백업' }
  ]
}
const RULE = nameRuleOf(RULE_RES)
const NO_RULE_RES = { exists: false, rules: [] }
const SCOPES = { processes: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }, { model: 'M2', eqpCount: 5 }] }, { process: 'Q', models: [{ model: 'QM', eqpCount: 2 }] }] }
const row = (name, over = {}) => ({ name, id: `P-M2-${name}`, isEnabled: true, type: 1, typeName: 'ALARM_RECOVERY', currentCrtime: 1730000000000, status: [], ...over })
const find = (w, id) => w.find(`[data-testid="${id}"]`)

// 13 §4.3 클래스 기본값(ScenarioProperty.cs initDefaultValue) + ScenarioTriggerType 0
const CLASS_DEFAULTS = {
  Owners: [], ScenarioTriggerType: 0, DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: false, DoNotSendEmailWhenFail: false,
  StartDelay: 0, RetryCnt: 0, RetryInterval: 10, NextScenarioIfSuccess: null, NextScenarioIfFail: null,
  DetailedDescriptionTitle: '', DetailedDescription: '', DescriptionFromConductor: '', EDMLink: '',
  IsEnabled: true, ExecutingLevel: 0, IsShowDialog: true, Priority: 10, LcncType: 0, LowcodeExtension: ''
}

describe('새 시나리오 규칙(editor/newScenario)', () => {
  const form = (over = {}) => ({ process: 'P', model: 'M2', type: 1, major: '', middle: '', part3: '', part4: '', name: '', description: '메일', timeoutLimit: '240', ...over })
  const codes = (issues) => Object.fromEntries(issues.map((i) => [i.field, i.code]))

  it('운영 속성 기본값 = 사내 클래스 기본값, ID = 공정-모델-이름, Type = 고른 값, ScenarioTriggerType 0', () => {
    expect(defaultProperty({ id: 'P-M2-NEW_ONE', type: 3 })).toEqual({ ID: 'P-M2-NEW_ONE', ...CLASS_DEFAULTS, Type: 3 })
    expect(DEFAULT_TIMEOUT).toBe('240')
  })

  it('newScenarioOf: 출처 없는 작업본(스텝 0, 제한 시간은 문자열)과 같은 대상을 담은 뼈대', () => {
    const { working, skeleton } = newScenarioOf({ process: 'P', model: 'M2', name: 'NEW_ONE', type: 1, description: '새 메일', timeoutLimit: 90 })
    expect(working).toEqual({ source: null, headCrtime: null, header: { description: '새 메일', timeoutLimit: '90', windows: { target: { text: '', className: '', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 }, hiding: [] } }, steps: [], property: defaultProperty({ id: 'P-M2-NEW_ONE', type: 1 }) })
    expect(skeleton).toMatchObject({ process: 'P', model: 'M2', name: 'NEW_ONE', id: 'P-M2-NEW_ONE', isNew: true, headCrtime: null, propertyRev: null, performance: null, steps: [], notes: [] })
    expect(skeleton.property).toBe(working.property)
    expect(skeleton.header).toEqual({ description: '새 메일', timeoutLimit: '90', targetWindow: null })
    expect(skeleton.edited).toBeUndefined() // beginSession 이 뼈대에서 출처를 만들지 않게
  })

  it('이름 규칙이 있으면 대·중분류 + 3번 칸(5자 이상) + 4번 칸(선택)으로 만든다 — 경우표', () => {
    const cases = [
      [{ major: 'ALARM', middle: 'RECOVERY', part3: 'E2201', part4: 'VACUUM' }, 'ALARM_RECOVERY_E2201_VACUUM', {}],
      [{ major: 'ALARM', middle: 'RECOVERY', part3: 'E2201' }, 'ALARM_RECOVERY_E2201', {}],
      [{ major: 'AUTO', middle: 'DATABACKUP' }, 'AUTO_DATABACKUP', {}], // 머리가 AUTO_DATABACKUP 이면 3번 칸을 비워도 된다
      [{ major: 'ALARM', middle: 'RECOVERY', part3: 'E12' }, 'ALARM_RECOVERY_E12', { part3: 'PART_SHORT' }],
      [{ major: 'ALARM', middle: 'RECOVERY', part3: 'E1234', part4: 'V-2' }, 'ALARM_RECOVERY_E1234_V-2', { part4: 'PART_CHARS' }],
      [{ major: 'ALARM', middle: 'RECOVERY', part3: 'E1234', part4: 'X'.repeat(30) }, `ALARM_RECOVERY_E1234_${'X'.repeat(30)}`, { name: 'BUILT_TOO_LONG' }],
      [{ major: '', middle: 'RECOVERY', part3: 'E1234' }, '', { major: 'MAJOR_REQUIRED' }]
    ]
    for (const [parts, name, want] of cases) {
      const f = form(parts)
      expect(newName(f, RULE), JSON.stringify(parts)).toBe(name)
      expect(codes(checkNewScenario(f, { rule: RULE })), JSON.stringify(parts)).toEqual(want)
    }
  })

  it('이름 규칙이 없으면 직접 입력(영문·숫자·_, 50자 이하)', () => {
    expect(codes(checkNewScenario(form({ name: 'PUMP_RESTART_E2201' }), { rule: null }))).toEqual({})
    expect(codes(checkNewScenario(form({ name: 'ALARM-E1234 RECOVERY' }), { rule: null }))).toEqual({ name: 'NAME_CHARS' })
    expect(codes(checkNewScenario(form({ name: 'A'.repeat(51) }), { rule: null }))).toEqual({ name: 'NAME_TOO_LONG' })
    expect(newName(form({ name: 'X1', major: 'ALARM' }), null)).toBe('X1')
  })

  it('빈 칸은 empty(손대기 전에는 숨김), 틀린 값은 아니다 — 메일 제목이 공백뿐이면 빈 값', () => {
    const issues = checkNewScenario(form({ process: '', model: '', type: 0, description: '  ', timeoutLimit: '' }), { rule: RULE })
    expect(issues.map((i) => [i.field, i.code, i.empty])).toEqual([
      ['process', 'PROCESS_REQUIRED', true], ['model', 'PROCESS_FIRST', true], ['type', 'TYPE_REQUIRED', true],
      ['major', 'MAJOR_REQUIRED', true], ['middle', 'MIDDLE_REQUIRED', true], ['part3', 'PART_SHORT', true],
      ['description', 'MAIL_TITLE_EMPTY', true], ['timeoutLimit', 'TIMEOUT_INVALID', true]
    ])
    const bad = checkNewScenario(form({ description: 'a:b', timeoutLimit: '0', part3: 'E1', major: 'ALARM', middle: 'RECOVERY' }), { rule: RULE })
    expect(bad.map((i) => [i.field, i.code, i.empty])).toEqual([['part3', 'PART_SHORT', false], ['description', 'MAIL_TITLE_COLON', false], ['timeoutLimit', 'TIMEOUT_INVALID', false]])
    expect(codes(checkNewScenario(form({ model: '' }), { rule: null }))).toMatchObject({ model: 'MODEL_REQUIRED' })
  })

  it('문구 키: 이름 만들기 code 는 SEW_NAME_, 새 시나리오 창 code 는 SEW_NEW_, 나머지는 서버와 같은 RULE_', () => {
    expect(issueKey({ code: 'PART_SHORT' })).toBe('SEW_NAME_PART_SHORT')
    expect(issueKey({ code: 'TYPE_REQUIRED' })).toBe('SEW_NEW_TYPE_REQUIRED')
    expect(issueKey({ code: 'MAIL_TITLE_COLON' })).toBe('RULE_MAIL_TITLE_COLON')
    expect(issueKey({ code: 'NAME_CHARS' })).toBe('RULE_NAME_CHARS')
    for (const c of ['PROCESS_REQUIRED', 'MODEL_REQUIRED', 'PROCESS_FIRST', 'TYPE_REQUIRED', 'MAJOR_REQUIRED', 'MIDDLE_REQUIRED', 'PART_SHORT', 'PART_CHARS', 'BUILT_TOO_LONG', 'BUILT_CHARS', 'NAME_EMPTY', 'NAME_TOO_LONG', 'NAME_CHARS', 'MAIL_TITLE_EMPTY', 'MAIL_TITLE_COLON', 'TIMEOUT_INVALID'])
      expect(MESSAGES[issueKey({ code: c })], c).toBeTruthy()
  })
})

describe('새 시나리오 창(NewScenarioDialog)', () => {
  let w = null
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
  })
  afterEach(() => { if (w) w.unmount(); w = null })

  // open: 'none' = 열린 시나리오 없음, 'open' = P/M/N 을 연 채(쓸 수 있는 세션), 'dirty' = 연 채 저장 전 변경 1곳
  async function setup({ rule = RULE_RES, rows = [], drafts = [], open = 'none', ruleFails = false, listFails = false } = {}) {
    let f = null
    if (open !== 'none') {
      f = panelFixture([noneStep(0), noneStep(1)])
      f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '', timeoutLimit: '1', targetWindow: null }, property: {}, performance: null }
      if (open === 'dirty') f.e.editCell('s0', 'onFalse', { kind: 'end', value: 'SUCCESS' })
    }
    const s = useEditorStore()
    s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }
    s.scopes = SCOPES
    if (ruleFails) api.nameRule.mockImplementation(() => fail(503, 'UPSTREAM_DOWN'))
    else api.nameRule.mockImplementation(() => ok(rule))
    if (listFails) api.list.mockImplementation(() => fail(503, 'UPSTREAM_DOWN'))
    else api.list.mockImplementation(() => ok(rows))
    api.listDrafts.mockImplementation(() => ok(drafts))
    w = mount(NewScenarioDialog, { props: { modelValue: true }, attachTo: document.body })
    await flushPromises()
    return { s, e: useEditStore(), f }
  }
  const pick = async (id, v) => { await find(w, id).setValue(v); await flushPromises() }
  async function fillRule({ model = 'M2', major = 'ALARM', middle = 'RECOVERY', part3 = 'E2201', part4 = '', type = '1', mail = '진공 펌프 알람' } = {}) {
    await pick('se-new-model', model)
    await pick('se-new-type', type)
    await pick('se-new-major', major)
    await pick('se-new-middle', middle)
    await pick('se-new-part3', part3)
    if (part4) await pick('se-new-part4', part4)
    await pick('se-new-mail', mail)
  }

  it('공정 미선택: 열린 시나리오가 없으면 공정을 고르게 하고, 모델은 공정을 먼저 고르라고 꺼 둔다 — 바닥 줄 안내·[만들기] 꺼짐', async () => {
    await setup()
    expect(find(w, 'se-new-process').element.value).toBe('')
    expect(find(w, 'se-new-process').findAll('option').map((o) => o.text())).toEqual([t('SEW_SAVE_MODEL_PICK'), 'P', 'Q'])
    expect(find(w, 'se-new-model').attributes('disabled')).toBeDefined()
    expect(find(w, 'se-new-model').text()).toBe(t('SEW_NEW_MODEL_WAIT'))
    const foot = find(w, 'se-new-foot').text()
    expect(foot).toContain(t('SEW_NEW_FOOT_PICK_FIRST'))
    expect(foot).toContain(t('SEW_NEW_FOOT_MISSING', { list: '공정 · 모델 · 유형 · 이름 · 메일 제목' }))
    expect(find(w, 'se-new-create').attributes('disabled')).toBeDefined()
    expect(find(w, 'se-new-msg-process').text()).toBe(t('SEW_NEW_PROCESS_HINT')) // 손대기 전에는 빨갛게 하지 않는다
    expect(api.list).not.toHaveBeenCalled()
    await pick('se-new-process', 'Q')
    expect(find(w, 'se-new-model').attributes('disabled')).toBeUndefined()
    expect(find(w, 'se-new-model').findAll('option').map((o) => o.text())).toEqual([t('SEW_SAVE_MODEL_PICK'), t('SEW_SAVE_MODEL_OPTION', { model: 'QM', n: 2 })])
  })

  it('열린 시나리오가 있으면 그 공정을 골라 두되 바꿀 수 있다 — 공정을 바꾸면 모델을 비운다', async () => {
    await setup({ open: 'open' })
    expect(find(w, 'se-new-process').element.value).toBe('P')
    expect(find(w, 'se-new-process').attributes('disabled')).toBeUndefined()
    expect(find(w, 'se-new-msg-process').text()).toBe(t('SEW_NEW_PROCESS_FROM_OPEN'))
    await pick('se-new-model', 'M2')
    expect(api.list).toHaveBeenLastCalledWith('P', 'M2')
    await pick('se-new-process', 'Q')
    expect(find(w, 'se-new-model').element.value).toBe('')
    expect(find(w, 'se-new-msg-process').text()).toBe(t('SEW_NEW_PROCESS_HINT'))
  })

  it('이름 규칙이 있으면 대·중분류 칸으로만 만들고 직접 입력 칸은 없다 — 이름·ID 미리 보기, 50자 세기', async () => {
    await setup({ open: 'open' })
    expect(find(w, 'se-new-name').exists()).toBe(false)
    expect(find(w, 'se-new-major').findAll('option').map((o) => o.text())).toEqual([t('SEW_SAVE_MODEL_PICK'), 'ALARM — 알람', 'AUTO — 자동 실행'])
    await fillRule({ part4: 'VACUUM' })
    expect(find(w, 'se-new-name-preview').text()).toBe('ALARM_RECOVERY_E2201_VACUUM')
    expect(find(w, 'se-new-count').text()).toBe('27 / 50')
    expect(find(w, 'se-new-id').text()).toContain('P-M2-ALARM_RECOVERY_E2201_VACUUM')
    expect(find(w, 'se-new-foot').text()).toBe(t('SEW_NEW_FOOT_OK'))
    expect(find(w, 'se-new-create').attributes('disabled')).toBeUndefined()
  })

  it('3번 칸 머리가 AUTO_DATABACKUP 이면 비워도 된다', async () => {
    await setup({ open: 'open' })
    await fillRule({ major: 'AUTO', middle: 'DATABACKUP', part3: '' })
    expect(find(w, 'se-new-msg-part3').text()).toBe(t('SEW_NEW_PART_FREE'))
    expect(find(w, 'se-new-name-preview').text()).toBe('AUTO_DATABACKUP')
    expect(find(w, 'se-new-create').attributes('disabled')).toBeUndefined()
  })

  it('이름 규칙이 없으면 이름 한 칸 직접 입력', async () => {
    await setup({ open: 'open', rule: NO_RULE_RES })
    expect(find(w, 'se-new-major').exists()).toBe(false)
    await pick('se-new-model', 'M2')
    await pick('se-new-type', '3')
    await pick('se-new-name', 'ALARM-E1234 RECOVERY')
    expect(find(w, 'se-new-msg-name').text()).toBe(t('RULE_NAME_CHARS'))
    await pick('se-new-name', 'PUMP_RESTART_E2201')
    await pick('se-new-mail', '진공 펌프 재시작')
    expect(find(w, 'se-new-count').text()).toBe('18 / 50')
    expect(find(w, 'se-new-create').attributes('disabled')).toBeUndefined()
  })

  it('검사 오류: 틀린 값은 치는 즉시, 빈 칸은 손댄 뒤에 빨갛고 바닥 줄에 고칠 곳 수·칸 이름', async () => {
    await setup({ open: 'open' })
    await pick('se-new-model', 'M2')
    await pick('se-new-major', 'ALARM')
    await pick('se-new-middle', 'RECOVERY')
    await pick('se-new-part3', 'E12')
    expect(find(w, 'se-new-msg-part3').text()).toBe(t('SEW_NAME_PART_SHORT', { min: 5, n: 3 }))
    expect(find(w, 'se-new-msg-type').text()).toBe(t('SEW_NEW_TYPE_HINT')) // 아직 손대지 않은 빈 칸
    await pick('se-new-part4', 'V-2')
    await pick('se-new-mail', 'E1234: 진공')
    await pick('se-new-timeout', '0')
    await find(w, 'se-new-type').trigger('blur')
    expect(find(w, 'se-new-msg-type').text()).toBe(t('SEW_NEW_TYPE_REQUIRED'))
    expect(find(w, 'se-new-msg-description').text()).toBe(t('RULE_MAIL_TITLE_COLON'))
    expect(find(w, 'se-new-msg-timeoutLimit').text()).toBe(t('RULE_TIMEOUT_INVALID'))
    expect(find(w, 'se-new-foot').text()).toBe(`${t('SEW_NEW_FOOT_FIX', { n: 5 })} · 유형, 3번 칸, 4번 칸, 메일 제목, 제한 시간`)
    expect(find(w, 'se-new-create').attributes('disabled')).toBeDefined()
  })

  it('제한 시간은 기본 240(문자열)이고 사람이 읽는 시간을 함께 보인다', async () => {
    await setup({ open: 'open' })
    expect(find(w, 'se-new-timeout').element.value).toBe('240')
    expect(find(w, 'se-new-timeout-human').text()).toBe(t('SEW_NEW_TIMEOUT_HUMAN', { text: '4시간' }))
    expect(find(w, 'se-new-msg-timeoutLimit').text()).toBe(t('SEW_NEW_TIMEOUT_IS_DEFAULT'))
    await pick('se-new-timeout', '90')
    expect(find(w, 'se-new-timeout-human').text()).toBe(t('SEW_NEW_TIMEOUT_HUMAN', { text: '1시간 30분' }))
    expect(find(w, 'se-new-msg-timeoutLimit').text()).toBe(t('SEW_NEW_TIMEOUT_DEFAULT'))
  })

  it('[만들기]: 빈 세션(출처 없음·스텝 0)과 운영 속성 기본값으로 시작하고, 열린 뼈대가 새 대상이 된다 — 창은 닫히고 알림', async () => {
    const { s, e } = await setup({ open: 'open' })
    await fillRule({ type: '3', mail: '새 메일' })
    await pick('se-new-timeout', '90')
    await find(w, 'se-new-create').trigger('click')
    await flushPromises()
    expect(w.emitted('update:modelValue').at(-1)).toEqual([false])
    const sess = e.session
    expect(sess).toMatchObject({ source: null, headCrtime: null, propertyRev: null, readOnly: null })
    expect(sess.working).toEqual({ source: null, headCrtime: null, header: { description: '새 메일', timeoutLimit: '90', windows: { target: { text: '', className: '', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 }, hiding: [] } }, steps: [], property: defaultProperty({ id: 'P-M2-ALARM_RECOVERY_E2201', type: 3 }) })
    expect(sess.saveBase).toBe(sess.working)
    expect(s.skeleton).toMatchObject({ process: 'P', model: 'M2', name: 'ALARM_RECOVERY_E2201', id: 'P-M2-ALARM_RECOVERY_E2201', isNew: true })
    expect(e.editable).toBe(true)
    expect(e.unsavedCount).toBe(0)
    expect(e.toast.text).toBe(t('SEW_NEW_MADE'))
  })

  it('이미 있는 이름이면 막고 [그 시나리오 열기] — 누르면 그 시나리오를 연다(저장 전 변경이 없으면 묻지 않는다)', async () => {
    const { s } = await setup({ open: 'open', rows: [row('ALARM_RECOVERY_E2201', { isEnabled: false, type: 3 })] })
    await fillRule()
    const note = find(w, 'se-new-exists')
    expect(note.text()).toContain(t('SEW_NEW_EXISTS', { model: 'M2', state: '꺼짐', type: '설비 컨디션유지', version: t('SEW_NEW_EXISTS_VERSION', { crtime: formatCrtime(1730000000000) }) }))
    expect(find(w, 'se-new-create').attributes('disabled')).toBeDefined()
    expect(find(w, 'se-new-foot').text()).toBe(`${t('SEW_NEW_FOOT_EXISTS')} ${t('SEW_NEW_FOOT_EXISTS_HOW')}`)
    api.open.mockReturnValue(ok({ process: 'P', model: 'M2', name: 'ALARM_RECOVERY_E2201', version: { crtime: 1, isCurrent: true }, steps: [], notes: [] }))
    await find(w, 'se-new-exists-open').trigger('click')
    await flushPromises()
    expect(api.open).toHaveBeenCalledWith('P', 'M2', 'ALARM_RECOVERY_E2201', 'current')
    expect(w.emitted('update:modelValue').at(-1)).toEqual([false])
    expect(s.skeleton.name).toBe('ALARM_RECOVERY_E2201')
  })

  it('같은 이름이 지금 열려 있는 시나리오면 열기 버튼 없이 다른 이름을 쓰라고 한다', async () => {
    await setup({ open: 'open', rows: [row('N_LONG_NAME')], rule: NO_RULE_RES })
    await pick('se-new-model', 'M')
    await pick('se-new-name', 'N')
    expect(find(w, 'se-new-exists').exists()).toBe(false) // 목록에 없는 이름
    api.list.mockImplementation(() => ok([row('N')]))
    await pick('se-new-model', 'M2')
    await pick('se-new-model', 'M') // 다른 쌍으로 갔다 오면 목록을 다시 읽는다
    expect(find(w, 'se-new-exists').text()).toBe(t('SEW_NEW_EXISTS_IS_OPEN'))
    expect(find(w, 'se-new-exists-open').exists()).toBe(false)
  })

  it('같은 이름 확인이 실패하면 만들 수 없고 [다시 확인]', async () => {
    await setup({ open: 'open', listFails: true })
    await fillRule()
    expect(find(w, 'se-new-names-failed').text()).toContain(t('SEW_NEW_NAMES_FAILED', { cause: t('SEW_ERR_UPSTREAM_DOWN') }))
    expect(find(w, 'se-new-create').attributes('disabled')).toBeDefined()
    api.list.mockImplementation(() => ok([]))
    await find(w, 'se-new-names-retry').trigger('click')
    await flushPromises()
    expect(find(w, 'se-new-names-failed').exists()).toBe(false)
    expect(find(w, 'se-new-create').attributes('disabled')).toBeUndefined()
  })

  it('이름 규칙을 읽지 못하면 이름을 만들 수 없고 [다시 읽기]', async () => {
    await setup({ open: 'open', ruleFails: true })
    expect(find(w, 'se-new-rule-failed').text()).toContain(t('SEW_NEW_RULE_FAILED', { cause: t('SEW_ERR_UPSTREAM_DOWN') }))
    expect(find(w, 'se-new-create').attributes('disabled')).toBeDefined()
    expect(find(w, 'se-new-major').exists()).toBe(false)
    expect(find(w, 'se-new-name').exists()).toBe(false)
    api.nameRule.mockImplementation(() => ok(RULE_RES))
    await find(w, 'se-new-rule-retry').trigger('click')
    await flushPromises()
    expect(find(w, 'se-new-major').exists()).toBe(true)
  })

  it('같은 새 ID 의 내 초안이 있으면 [초안 이어서 열기]를 권한다(만들기는 막지 않는다)', async () => {
    const draft = { draftId: 'd1', name: 'ALARM_RECOVERY_E2201', target: { model: 'M2', name: 'ALARM_RECOVERY_E2201' }, base: null, savedAt: '2026-11-08T01:37:00.000Z', revision: 2 }
    await setup({ open: 'open', drafts: [draft, { ...draft, draftId: 'd2', name: 'OTHER_NAME' }] })
    await fillRule()
    expect(api.listDrafts).toHaveBeenLastCalledWith('P', 'M2')
    expect(find(w, 'se-new-draft').exists()).toBe(true)
    expect(find(w, 'se-new-create').attributes('disabled')).toBeUndefined()
    await find(w, 'se-new-draft-open').trigger('click')
    expect(w.emitted('open-draft')[0][0]).toMatchObject({ draftId: 'd1', process: 'P', model: 'M2', name: 'ALARM_RECOVERY_E2201' })
    expect(w.emitted('update:modelValue').at(-1)).toEqual([false])
  })

  describe('저장 전 변경이 있을 때', () => {
    it('창 안에 미리 알리고, [만들기] 뒤 돌아가기·버리고 만들기·초안 저장하고 만들기를 묻는다 — [돌아가기]는 창으로', async () => {
      const { e } = await setup({ open: 'dirty' })
      expect(find(w, 'se-new-unsaved').text()).toBe(t('SEW_NEW_UNSAVED_WARN', { name: 'N', n: 1 }))
      await fillRule()
      await find(w, 'se-new-create').trigger('click')
      await flushPromises()
      expect(document.activeElement?.getAttribute('data-testid')).toBe('se-new-cf-back')
      const cf = find(w, 'se-new-cf')
      expect(cf.text()).toContain(t('SEW_NEW_CF_BODY_CREATE', { name: 'N', n: 1 }))
      expect([find(w, 'se-new-cf-back').text(), find(w, 'se-new-cf-drop').text(), find(w, 'se-new-cf-draft').text()])
        .toEqual([t('SEW_NEW_CF_BACK'), t('SEW_NEW_CF_DROP_CREATE'), t('SEW_NEW_CF_DRAFT_CREATE')])
      await find(w, 'se-new-cf-back').trigger('click')
      expect(find(w, 'se-new-cf').exists()).toBe(false)
      expect(e.session.source.name).toBe('N') // 아무것도 바뀌지 않았다
    })
    it('[버리고 만들기]는 바로 새 시나리오로', async () => {
      const { e } = await setup({ open: 'dirty' })
      await fillRule()
      await find(w, 'se-new-create').trigger('click')
      await find(w, 'se-new-cf-drop').trigger('click')
      await flushPromises()
      expect(e.session.source).toBe(null)
      expect(api.saveDraft).not.toHaveBeenCalled()
      expect(e.toast.text).toBe(t('SEW_NEW_MADE'))
    })
    it('[초안 저장하고 만들기]는 열린 시나리오의 초안을 저장한 뒤 만든다', async () => {
      const { e } = await setup({ open: 'dirty' })
      api.saveDraft.mockReturnValue(ok({ draftId: 'd9', savedAt: '2026-11-09T01:00:00.000Z' }))
      await fillRule()
      await find(w, 'se-new-create').trigger('click')
      await find(w, 'se-new-cf-draft').trigger('click')
      await flushPromises()
      const meta = JSON.parse(api.saveDraft.mock.calls[0][0].get('meta'))
      expect(meta.target).toEqual({ process: 'P', model: 'M', name: 'N' })
      expect(meta.scenario.steps[0].next.onFalse).toEqual({ kind: 'end', value: 'SUCCESS' })
      expect(e.session.source).toBe(null)
      expect(e.toast.text).toBe(t('SEW_NEW_MADE_DRAFT', { prev: 'N' }))
    })
    it('초안 저장이 실패하면 만들지 않고 원인을 보인다(확인 창은 남는다)', async () => {
      const { e } = await setup({ open: 'dirty' })
      api.saveDraft.mockImplementation(() => fail(503, 'UPSTREAM_DOWN'))
      await fillRule()
      await find(w, 'se-new-create').trigger('click')
      await find(w, 'se-new-cf-draft').trigger('click')
      await flushPromises()
      expect(find(w, 'se-new-cf-error').text()).toContain(t('SEW_NEW_DRAFT_FAILED_CREATE', { cause: t('SEW_SAVE_CAUSE_UPSTREAM_DOWN') }))
      expect(e.session.source.name).toBe('N')
    })
    it('초안을 저장한 뒤 만들기가 실패하면 그 사실과 초안을 저장해 두었다고 알리고 창을 남긴다(SEW-023)', async () => {
      const { e, s } = await setup({ open: 'dirty' })
      api.saveDraft.mockImplementation(() => { s.me = { ...s.me, canWrite: false }; return ok({ draftId: 'd9', savedAt: '2026-11-09T01:00:00.000Z' }) })
      await fillRule()
      await find(w, 'se-new-create').trigger('click')
      await find(w, 'se-new-cf-draft').trigger('click')
      await flushPromises()
      expect(e.session.source.name).toBe('N')
      expect(e.toast.text).toBe(t('SEW_NEW_CREATE_FAILED_DRAFT', { prev: 'N' }))
      expect(w.emitted('update:modelValue')).toBeUndefined()
    })
    it('초안을 저장한 뒤 그 시나리오를 열지 못하면 앞 시나리오는 초안으로 저장해 두었다고 알린다(SEW-023)', async () => {
      const { e } = await setup({ open: 'dirty', rows: [row('ALARM_RECOVERY_E2201')] })
      api.saveDraft.mockReturnValue(ok({ draftId: 'd9', savedAt: '2026-11-09T01:00:00.000Z' }))
      api.open.mockImplementation(() => fail(503, 'UPSTREAM_DOWN'))
      await fillRule()
      await find(w, 'se-new-exists-open').trigger('click')
      await find(w, 'se-new-cf-draft').trigger('click')
      await flushPromises()
      expect(api.open).toHaveBeenCalled()
      expect(e.toast.text).toBe(t('SEW_NEW_OPEN_FAILED_DRAFT', { prev: 'N', name: 'ALARM_RECOVERY_E2201' }))
    })
    it('확인 덮개가 떠 있으면 Tab 이 덮개의 단추 안에서만 돈다(SEW-023)', async () => {
      await setup({ open: 'dirty' })
      await fillRule()
      await find(w, 'se-new-create').trigger('click')
      await flushPromises()
      const back = find(w, 'se-new-cf-back').element
      const draft = find(w, 'se-new-cf-draft').element
      draft.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      expect(document.activeElement).toBe(back)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
      expect(document.activeElement).toBe(draft)
      find(w, 'se-new-mail').element.focus() // 덮개 밖(뒤 창의 칸)에 초점이 있어도 Tab 이면 덮개로 돌아온다
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
      expect(document.activeElement).toBe(back)
    })
    it('[그 시나리오 열기]도 같은 확인(열기 말)을 거친다', async () => {
      await setup({ open: 'dirty', rows: [row('ALARM_RECOVERY_E2201')] })
      await fillRule()
      await find(w, 'se-new-exists-open').trigger('click')
      expect(find(w, 'se-new-cf').text()).toContain(t('SEW_NEW_CF_BODY_OPEN', { name: 'N', n: 1 }))
      expect(find(w, 'se-new-cf-drop').text()).toBe(t('SEW_NEW_CF_DROP_OPEN'))
      expect(api.open).not.toHaveBeenCalled()
    })
    const opened = () => ok({ process: 'P', model: 'M2', name: 'ALARM_RECOVERY_E2201', version: { crtime: 1, isCurrent: true }, steps: [], notes: [] })
    it('[그 시나리오 열기] → [버리고 열기]는 초안 없이 그 시나리오를 연다(SEW-024)', async () => {
      const { s } = await setup({ open: 'dirty', rows: [row('ALARM_RECOVERY_E2201')] })
      api.open.mockReturnValue(opened())
      await fillRule()
      await find(w, 'se-new-exists-open').trigger('click')
      await find(w, 'se-new-cf-drop').trigger('click')
      await flushPromises()
      expect(api.saveDraft).not.toHaveBeenCalled()
      expect(api.open).toHaveBeenCalledWith('P', 'M2', 'ALARM_RECOVERY_E2201', 'current')
      expect(s.skeleton.name).toBe('ALARM_RECOVERY_E2201')
      expect(w.emitted('update:modelValue').at(-1)).toEqual([false])
    })
    it('[그 시나리오 열기] → [초안 저장하고 열기]는 열린 시나리오의 초안을 저장한 뒤 열고 알린다(SEW-024)', async () => {
      const { s, e } = await setup({ open: 'dirty', rows: [row('ALARM_RECOVERY_E2201')] })
      api.saveDraft.mockReturnValue(ok({ draftId: 'd9', savedAt: '2026-11-09T01:00:00.000Z' }))
      api.open.mockReturnValue(opened())
      await fillRule()
      await find(w, 'se-new-exists-open').trigger('click')
      await find(w, 'se-new-cf-draft').trigger('click')
      await flushPromises()
      expect(JSON.parse(api.saveDraft.mock.calls[0][0].get('meta')).target).toEqual({ process: 'P', model: 'M', name: 'N' })
      expect(api.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(api.open.mock.invocationCallOrder[0])
      expect(s.skeleton.name).toBe('ALARM_RECOVERY_E2201')
      expect(e.toast.text).toBe(t('SEW_NEW_OPENED_DRAFT', { prev: 'N', name: 'ALARM_RECOVERY_E2201' }))
    })
  })
})
