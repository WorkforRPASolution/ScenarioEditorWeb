import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ScenarioBar from '../components/ScenarioBar.vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { useSaveFlow } from '../stores/saveFlow'
import { MESSAGES, t } from '../messages'
import { buildMeta } from '../editor/request'
import { unsavedChanges } from '../editor/diff'
import { panelFixture, noneStep } from './panelFixture'

const ModalStub = { name: 'ModalShell', props: ['modelValue', 'title'], template: '<div v-if="modelValue" :data-title="title"><slot /></div>' }
const skeleton = (over = {}) => ({
  process: 'SEWCVD', model: 'SEWMODELA', name: 'X', id: 'SEWCVD-SEWMODELA-X', version: { crtime: 1730000000000, isCurrent: true },
  header: { description: '메일 제목', timeoutLimit: '240', targetWindow: { agentFinds: false, matchMode: null, reasonCode: 'TEXT_EMPTY', inHouseShowsSet: true, raw: { Text: null, ClassName: null } } },
  property: { IsEnabled: true, Type: 1, Priority: 3, Owners: ['a@2026-11-01 10:00:00'], ScenarioTriggerType: 0, StartDelay: 0, RetryCnt: 0, RetryInterval: 10,
    NextScenarioIfSuccess: null, NextScenarioIfFail: { Name: 'NEXT_SC', Text: 't' }, DetailedDescriptionTitle: '', DetailedDescription: '', DescriptionFromConductor: '심의 메모', EDMLink: '',
    ExecutingLevel: 0, IsShowDialog: true, LcncType: 0, LowcodeExtension: '', DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: false, DoNotSendEmailWhenFail: false, ID: 'X' },
  performance: { gradeName: 'A', supervisor: 'Not entered', supervisorNotEntered: true, scenarioDescription: '설명', rawKeys: ['Grade'], eqpPerformanceLoss: 0, waferLoss: 42 },
  steps: [{ uid: 's0', no: 1, notes: [{ level: 'warning', code: 'X' }] }], notes: [{ level: 'info', code: 'TARGET_WINDOW_DIFFERS' }], ...over
})

describe('ScenarioBar', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const mountBar = () => mount(ScenarioBar, { global: { stubs: { ModalShell: ModalStub } } })

  it('스텝을 바꾸면 시나리오 경고 줄에서도 낡은 NO_SUCCESS 가 빠진다(경고 수와 같게)', async () => {
    const next = { onTrue: { kind: 'end', value: 'FAIL' }, onFalse: { kind: 'end', value: 'FAIL' } }
    const step = { uid: 's0', origin: 0, condition: { kind: 'none', skipPreprocessing: false }, action: { type: 0 }, retry: { limit: 0, intervalMs: 2000 }, next, descriptionToEmail: 'a', images: { train: {}, base: null } }
    const edited = { source: null, headCrtime: 1, header: {}, steps: [step], property: {} }
    const sk = skeleton({ notes: [{ level: 'warning', code: 'NO_SUCCESS', params: {} }, { level: 'info', code: 'PRIORITY_NONSTANDARD', params: { priority: 3 } }], steps: [{ ...step, no: 1, notes: [] }], edited })
    const s = useEditorStore(); s.skeleton = sk
    const e = useEditStore(); e.begin(sk, { canWrite: true })
    const w = mountBar()
    expect(w.find('[data-testid="se-scenario-notes"]').text()).toContain(MESSAGES.SEW_NOTE_NO_SUCCESS)
    e.session = { ...e.session, working: { ...edited, steps: [...edited.steps] } } // 스텝 배열이 기준점과 달라짐
    await w.vm.$nextTick()
    expect(w.find('[data-testid="se-scenario-notes"]').text()).not.toContain(MESSAGES.SEW_NOTE_NO_SUCCESS)
  })
  it('열린 시나리오가 없으면 불러오기만', () => {
    const w = mountBar()
    expect(w.find('[data-testid="se-load"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-property"]').exists()).toBe(false)
  })
  it('ID·메일 제목·현재 버전·켜짐·유형·등급·대상 창·경고 수', () => {
    const s = useEditorStore(); s.skeleton = skeleton()
    const text = mountBar().text()
    for (const v of ['SEWCVD-SEWMODELA-X', '메일 제목', '240분', '현재 버전', '켜짐', '알람자동조치', '등급 A', '실행 때 창을 찾지 않음', '창 제목이 비어 있음', '경고 1', '알림 1'])
      expect(text).toContain(v)
    expect(text).toContain('사내 편집기에서는')
  })
  it('옛 버전 표시', () => {
    const s = useEditorStore(); s.skeleton = skeleton({ version: { crtime: 1720000000000, isCurrent: false } })
    expect(mountBar().text()).toContain('옛 버전')
  })
  it('P1 에서는 편집·저장·시험 실행 버튼이 없다(숨김)', () => {
    const s = useEditorStore(); s.skeleton = skeleton()
    const text = mountBar().text()
    for (const v of ['저장', '새 시나리오', '시험 실행']) expect(text).not.toContain(v)
  })
  it('데이터 점검은 0 이면 숨기고, 있으면 수와 창(열린 시나리오가 없어도)', async () => {
    const s = useEditorStore()
    const w = mountBar()
    expect(w.find('[data-testid="se-data-check"]').exists()).toBe(false)
    s.dataCheck = { duplicateUsers: [], duplicateEqpIds: ['SEWT_DUP01'], invalidEquipment: [{ eqpId: 'SEWT_BADREQ', reason: 'REQUIRED_EMPTY' }], proxyIpDuplicates: [], duplicateProperties: [] }
    await w.vm.$nextTick()
    await w.find('[data-testid="se-data-check"]').trigger('click')
    expect(w.text()).toContain('2')
    expect(w.text()).toContain('SEWT_DUP01')
    expect(w.text()).toContain('필수 필드 빈 값')
  })
  it('운영 속성 창: 현재 값 안내·비표준 우선순위·후속 시나리오·미입력', async () => {
    const s = useEditorStore(); s.skeleton = skeleton()
    const w = mountBar()
    await w.find('[data-testid="se-property"]').trigger('click')
    const text = w.text()
    for (const v of ['운영 속성은 버전과 상관없이 현재 값입니다', '1·5·10', 'NEXT_SC', '미입력']) expect(text).toContain(v)
  })
  it('운영 속성 창: 심의 의견은 DescriptionFromConductor, 성과는 웨이퍼 손실(사내 이름)', async () => {
    const s = useEditorStore(); s.skeleton = skeleton()
    const w = mountBar()
    await w.find('[data-testid="se-property"]').trigger('click')
    const text = w.text()
    expect(text).toContain('심의 메모')
    expect(text).toContain('웨이퍼 손실')
    expect(text).toContain('42')
    expect(text).not.toContain('글라스 손실')
  })

  describe('시나리오 단위 경고·알림 줄', () => {
    let w
    afterEach(() => { if (w) w.unmount(); w = null; vi.useRealTimers() })
    const twNone = { agentFinds: false, matchMode: null, reasonCode: 'TEXT_EMPTY', inHouseShowsSet: false, raw: { Text: null, ClassName: null } }
    const scenarioNotes = [
      { level: 'warning', code: 'PARSE_FAILED', params: { field: 'body' } },
      { level: 'warning', code: 'PARSE_FAILED', params: { field: 'bi' } },
      { level: 'warning', code: 'NO_SUCCESS', params: {} },
      { level: 'info', code: 'PRIORITY_NONSTANDARD', params: { priority: 3 } }
    ]

    it('TARGET_WINDOW_DIFFERS 를 뺀 시나리오 경고·알림을 문구로 나열한다(PARSE_FAILED 는 field 별 문구)', () => {
      const s = useEditorStore()
      s.skeleton = skeleton({ notes: [...scenarioNotes, { level: 'info', code: 'TARGET_WINDOW_DIFFERS', params: { reasonCode: 'TEXT_EMPTY' } }] })
      w = mountBar()
      const line = w.find('[data-testid="se-scenario-notes"]')
      expect(line.exists()).toBe(true)
      for (const k of ['SEW_NOTE_PARSE_FAILED_body', 'SEW_NOTE_PARSE_FAILED_bi', 'SEW_NOTE_NO_SUCCESS']) expect(line.text()).toContain(MESSAGES[k])
      expect(line.text()).toContain('1·5·10')
      expect(line.text()).not.toContain(MESSAGES.SEW_NOTE_TARGET_WINDOW_DIFFERS)
      expect(line.text()).not.toContain(MESSAGES.SEW_NOTE_PARSE_FAILED)
      // 대상 창 안내는 대상 창 자리에 한 번만
      expect(w.text().split(MESSAGES.SEW_NOTE_TARGET_WINDOW_DIFFERS)).toHaveLength(2)
    })
    it('대상 창 알림만 있거나 시나리오 알림이 없으면 줄이 없다', () => {
      const s = useEditorStore()
      s.skeleton = skeleton()
      w = mountBar()
      expect(w.find('[data-testid="se-scenario-notes"]').exists()).toBe(false)
      s.skeleton = skeleton({ notes: [] })
      expect(mountBar().find('[data-testid="se-scenario-notes"]').exists()).toBe(false)
    })
    it('스텝 경고가 없고 시나리오 경고만 있으면 "경고 n · 알림 n" 이 시나리오 경고 줄로 간다(포커스·강조)', async () => {
      vi.useFakeTimers()
      const s = useEditorStore()
      s.skeleton = skeleton({ steps: [{ uid: 's0', no: 1, notes: [] }], notes: scenarioNotes, header: { ...skeleton().header, targetWindow: twNone } })
      s.selectedUid = 's0'
      w = mount(ScenarioBar, { attachTo: document.body, global: { stubs: { ModalShell: ModalStub } } })
      const line = w.find('[data-testid="se-scenario-notes"]')
      line.element.scrollIntoView = vi.fn()
      expect(line.attributes('data-flash')).toBe('false')
      await w.find('[data-testid="se-notes"]').trigger('click')
      expect(s.selectedUid).toBe('s0')
      expect(document.activeElement).toBe(line.element)
      expect(line.element.scrollIntoView).toHaveBeenCalled()
      expect(line.attributes('data-flash')).toBe('true')
      vi.advanceTimersByTime(3000)
      await w.vm.$nextTick()
      expect(line.attributes('data-flash')).toBe('false')
    })
    it('대상 창 알림만 있으면 버튼이 대상 창 안내 줄을 강조한다', async () => {
      const s = useEditorStore()
      s.skeleton = skeleton({ steps: [{ uid: 's0', no: 1, notes: [] }] })
      w = mount(ScenarioBar, { attachTo: document.body, global: { stubs: { ModalShell: ModalStub } } })
      const tw = w.find('[data-testid="se-bar-tw-differs"]')
      tw.element.scrollIntoView = vi.fn()
      await w.find('[data-testid="se-notes"]').trigger('click')
      expect(document.activeElement).toBe(tw.element)
      expect(tw.attributes('data-flash')).toBe('true')
    })
    it('스텝 경고가 있으면 지금처럼 그 스텝을 고르고 줄을 강조하지 않는다', async () => {
      const s = useEditorStore()
      s.skeleton = skeleton({ steps: [{ uid: 's0', no: 1, notes: [] }, { uid: 's1', no: 2, notes: [{ level: 'warning', code: 'UNREACHABLE' }] }], notes: scenarioNotes })
      s.selectedUid = 's0'
      w = mount(ScenarioBar, { attachTo: document.body, global: { stubs: { ModalShell: ModalStub } } })
      await w.find('[data-testid="se-notes"]').trigger('click')
      expect(s.selectedUid).toBe('s1')
      expect(w.find('[data-testid="se-scenario-notes"]').attributes('data-flash')).toBe('false')
    })
  })

  describe('바 칸 — 메일 제목·제한 시간(P2-D Task 3)', () => {
    const find = (w, id) => w.find(`[data-testid="${id}"]`)
    const setup = (opts = {}) => {
      const f = panelFixture([noneStep(0), noneStep(1)], opts)
      f.edit = f.e
      f.e.session = { ...f.e.session, working: { ...f.e.session.working, header: { description: '메일 제목', timeoutLimit: '240' } } }
      f.e.session = { ...f.e.session, saveBase: f.e.session.working }
      f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '메일 제목', timeoutLimit: '240', targetWindow: null }, property: null, performance: null }
      return { ...f, w: mount(ScenarioBar, { global: { stubs: { ModalShell: ModalStub } } }) }
    }
    const type = async (w, id, v) => { const el = find(w, id); el.element.value = v; await el.trigger('input') }

    it('두 칸은 입력이고 작업본 값을 보인다(뼈대 값이 아니라)', async () => {
      const { w, e } = setup()
      expect(find(w, 'se-bar-description').element.value).toBe('메일 제목')
      expect(find(w, 'se-bar-timeout').element.value).toBe('240')
      e.setHeader('description', '고침')
      await w.vm.$nextTick()
      expect(find(w, 'se-bar-description').element.value).toBe('고침')
    })
    it("메일 제목에 ':' 를 쓰면 오류, 저장 개수에 바 칸 1", async () => {
      const { w, e } = setup()
      await type(w, 'se-bar-description', 'a:b')
      expect(find(w, 'se-bar-error-description').text()).toBe(MESSAGES.RULE_MAIL_TITLE_COLON)
      expect(find(w, 'se-save').text()).toContain('(1)')
      expect(find(w, 'se-bar-unsaved').text()).toContain('저장 전 1곳')
      expect(unsavedChanges(e.session.working, e.session.saveBase)).toEqual([{ kind: 'field', key: 'description', before: '메일 제목', after: 'a:b' }])
    })
    it('빈 제목·제한 시간 0 은 오류, 오류가 없으면 줄이 없다', async () => {
      const { w } = setup()
      expect(find(w, 'se-bar-error-description').exists()).toBe(false)
      await type(w, 'se-bar-description', '')
      expect(find(w, 'se-bar-error-description').text()).toBe(MESSAGES.RULE_MAIL_TITLE_EMPTY)
      await type(w, 'se-bar-timeout', '0')
      expect(find(w, 'se-bar-error-timeout').text()).toBe(MESSAGES.RULE_TIMEOUT_INVALID)
      await type(w, 'se-bar-timeout', '15')
      expect(find(w, 'se-bar-error-timeout').exists()).toBe(false)
    })
    it('제한 시간 상한(서버 TIMEOUT_MAX 2147483647) 넘으면 오류, 상한 값은 통과, 큰 수도 글자 그대로 둔다', async () => {
      const { w, e } = setup()
      await type(w, 'se-bar-timeout', '2147483648')
      expect(find(w, 'se-bar-error-timeout').text()).toBe(MESSAGES.RULE_TIMEOUT_INVALID)
      await type(w, 'se-bar-timeout', '99999999999999999999')
      expect(e.session.working.header.timeoutLimit).toBe('99999999999999999999')
      await type(w, 'se-bar-timeout', '2147483647')
      expect(find(w, 'se-bar-error-timeout').exists()).toBe(false)
    })
    it('입력하는 동안 입력칸을 다시 그리지 않는다(같은 요소)', async () => {
      const { w } = setup()
      const el = find(w, 'se-bar-description').element
      await type(w, 'se-bar-description', 'a:b')
      await type(w, 'se-bar-description', 'a:bc')
      expect(find(w, 'se-bar-description').element).toBe(el)
    })
    it('읽기 전용이면 입력이 없고 값만 보인다', () => {
      const { w } = setup({ canWrite: false })
      expect(find(w, 'se-bar-description').element.tagName).not.toBe('INPUT')
      expect(find(w, 'se-bar-description').text()).toContain('메일 제목')
      expect(find(w, 'se-bar-timeout').text()).toContain('240')
      expect(find(w, 'se-save').exists()).toBe(false)
    })
    it('바 칸은 되돌리기 목록에 들지 않고, 저장 요청(buildMeta)이 고친 값을 싣는다', async () => {
      const { w, e } = setup()
      await type(w, 'se-bar-description', '새 제목')
      await type(w, 'se-bar-timeout', '15')
      expect(e.undo.length).toBe(0)
      const { meta } = buildMeta(e.session)
      expect(meta.scenario.header).toEqual({ description: '새 제목', timeoutLimit: '15' })
      expect(typeof meta.scenario.header.timeoutLimit).toBe('string') // 서버 규칙은 문자열만 받는다
    })
    it('저장 창을 열었다 닫아도 값이 남는다', async () => {
      const { w, e } = setup()
      await type(w, 'se-bar-description', '새 제목')
      await find(w, 'se-save').trigger('click')
      useSaveFlow().close?.()
      expect(e.session.working.header.description).toBe('새 제목')
      expect(find(w, 'se-bar-description').element.value).toBe('새 제목')
    })
    it('고친 곳이 없으면 [저장] 에 개수가 없다', () => {
      const { w } = setup()
      expect(find(w, 'se-save').text()).toBe(MESSAGES.SEW_SAVE_OPEN)
      expect(find(w, 'se-bar-unsaved').exists()).toBe(false)
    })
    it('읽기 전용 세션의 setHeader 는 아무것도 바꾸지 않는다', () => {
      const { e } = setup({ canWrite: false })
      expect(e.setHeader('description', 'x')).toBe(false)
      expect(e.session.working.header.description).toBe('메일 제목')
    })
  })
})
