import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// 바가 여는 창(저장 창 검사·운영 속성 창 후속 목록)이 실제 서버로 요청하지 않게
const api = vi.hoisted(() => {
  const ok = (data) => Promise.resolve({ data: { success: true, data } })
  return { check: vi.fn(() => ok({ blocks: [], warns: [], target: { exists: true, eqpCount: 1 }, conflict: null, targetExists: null })), nameRule: vi.fn(() => ok({ exists: false, rules: [] })), list: vi.fn(() => ok([])), deployAttention: vi.fn(() => ok({ items: [] })) }
})
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import ScenarioBar from '../components/ScenarioBar.vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { useSaveFlow } from '../stores/saveFlow'
import { MESSAGES, t } from '../messages'
import { buildMeta } from '../editor/request'
import { unsavedChanges } from '../editor/diff'
import { panelFixture, noneStep } from './panelFixture'
import { formatCrtime } from '../format'
import { SECONDARY } from '../components/buttonStyle'

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

  describe('"확인할 배포 n건"(SEW-021)', () => {
    const R1 = '11111111-2222-4333-8444-555555555555'
    const R2 = '11111111-2222-4333-8444-666666666666'
    const ok = (data) => Promise.resolve({ data: { success: true, data } })
    const it1 = (rid, result = 'unknown') => ({ requestId: rid, target: { process: 'P', model: 'M', name: 'N' }, startedAt: '2026-11-19T01:02:03.000Z', result, crtime: null, targetWasNew: false })
    it('확인할 배포가 있으면 시나리오를 열지 않아도 바에 건수가 보이고, 누르면 목록 창이 열린다', async () => {
      api.deployAttention.mockImplementationOnce(() => ok({ items: [it1(R1), it1(R2, 'partial')] }))
      useEditorStore().me = { singleid: 'u', canWrite: true }
      const w = mountBar()
      await new Promise((r) => setTimeout(r, 0)); await w.vm.$nextTick()
      const b = w.find('[data-testid="se-deploy-attention"]')
      expect(b.text()).toBe('확인할 배포 2건')
      await b.trigger('click')
      expect(w.find('[data-title="확인할 배포"]').exists()).toBe(true)
    })
    it('없으면 보이지 않는다', async () => {
      useEditorStore().me = { singleid: 'u', canWrite: true }
      const w = mountBar()
      await new Promise((r) => setTimeout(r, 0)); await w.vm.$nextTick()
      expect(w.find('[data-testid="se-deploy-attention"]').exists()).toBe(false)
    })
  })

  describe('[시험 실행] 버튼(P5 설계 §4.1)', () => {
    it('시나리오를 열지 않아도 보이고 눌린다 — 누르면 시험 실행 창이 열린다', async () => {
      const store = useEditorStore()
      store.me = { singleid: 'u', canWrite: true, testRun: { enabled: true, reason: null } }
      const w = mountBar()
      const btn = w.find('[data-testid="se-run-open"]')
      expect(btn.text()).toBe(t('SEW_RUN_OPEN'))
      expect(btn.attributes('disabled')).toBeUndefined()
      const { useTestRunStore } = await import('../stores/testRunStore')
      expect(useTestRunStore().open).toBe(false)
      await btn.trigger('click')
      expect(useTestRunStore().open).toBe(true)
    })
    it('쓸 수 없으면 꺼지고 까닭이 title 에 — 쓰기 권한 없음·읽기 전용 서버·서버에서 꺼 둠·사용자 바꾸기', () => {
      const store = useEditorStore()
      for (const reason of ['WRITE_FORBIDDEN', 'WRITE_DISABLED', 'TEST_RUN_DISABLED', 'TEST_RUN_DEV_USER', 'TEST_RUN_USER_AMBIGUOUS']) {
        store.me = { singleid: 'u', canWrite: false, testRun: { enabled: false, reason } }
        const btn = mountBar().find('[data-testid="se-run-open"]')
        expect(btn.attributes('disabled'), reason).toBeDefined()
        expect(btn.attributes('title'), reason).toBe(MESSAGES[`SEW_RUN_OFF_${reason}`])
      }
    })
    it('서버가 시험 실행 정보를 주지 않으면(옛 서버) 버튼을 두지 않는다', () => {
      const store = useEditorStore()
      store.me = { singleid: 'u', canWrite: true }
      expect(mountBar().find('[data-testid="se-run-open"]').exists()).toBe(false)
    })
  })

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
  describe('바 머리 줄(SEW-023)', () => {
  const barWith = ({ canWrite }) => {
    const f = panelFixture([noneStep(0)], { canWrite })
    f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '메일 제목', timeoutLimit: '1', targetWindow: null }, property: null, performance: null }
    return mount(ScenarioBar, { global: { stubs: { ModalShell: ModalStub } } })
  }
  it('편집할 수 있으면 시나리오 ID 아래에 빈 줄 요소를 남기지 않는다 — 읽기 전용이면 메일 제목·제한 시간 줄', async () => {
    const a = barWith({ canWrite: true })
    expect(a.find('[data-testid="se-bar-meta"]').exists()).toBe(false)
    expect(a.find('[data-testid="se-bar-fields"]').exists()).toBe(true)
    a.unmount()
    setActivePinia(createPinia())
    const b = barWith({ canWrite: false })
    expect(b.find('[data-testid="se-bar-meta"]').text()).toContain('제한')
    b.unmount()
  })
})

describe('버튼 모양(2026-11-19 사용자 결정 A — 테두리 버튼 + 색 아이콘)', () => {
    const cls = (w, id) => w.find(`[data-testid="${id}"]`).classes()
    const secondary = SECONDARY.split(' ')
    const open = (canWrite = true) => {
      const f = panelFixture([noneStep(0)], { canWrite })
      f.s.me = { ...f.s.me, testRun: { enabled: canWrite, reason: canWrite ? null : 'WRITE_FORBIDDEN' } }
      f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '메일 제목', timeoutLimit: '1', targetWindow: null }, property: null, performance: null }
      return { ...f, w: mount(ScenarioBar, { global: { stubs: { ModalShell: ModalStub } } }) }
    }
    it('불러오기·새 시나리오·시나리오 실행·운영 속성 전체는 흰 바탕·회색 테두리 보조 단추이고, 역할 색 아이콘이 붙는다', () => {
      const { w } = open()
      const icons = { 'se-load': 'text-primary-500', 'se-new': 'text-green-600', 'se-run-open': 'text-purple-500', 'se-property': 'text-gray-500' }
      for (const [id, color] of Object.entries(icons)) {
        for (const c of secondary) expect(cls(w, id), `${id} ${c}`).toContain(c)
        expect(cls(w, id), id).not.toContain('bg-gray-200')
        const icon = w.find(`[data-testid="${id}"] svg`)
        expect(icon.exists(), id).toBe(true)
        expect(icon.attributes('aria-hidden'), id).toBe('true')
        expect(icon.classes(), id).toContain(color)
      }
      w.unmount()
    })
    it('[저장] 은 바뀐 것이 있으면 채운 파랑(주 동작), 없으면 파랑 글자의 보조 단추', async () => {
      const { w, e } = open()
      expect(cls(w, 'se-save')).toContain('bg-white')
      expect(cls(w, 'se-save')).not.toContain('bg-primary-500')
      expect(w.find('[data-testid="se-save"] svg').exists()).toBe(true)
      e.setHeader('description', '고친 제목')
      await w.vm.$nextTick()
      expect(cls(w, 'se-save')).toContain('bg-primary-500')
      expect(cls(w, 'se-save')).toContain('text-white')
      expect(cls(w, 'se-save')).not.toContain('bg-white')
      w.unmount()
    })
    it('[시나리오 실행] 이 꺼지면 같은 보조 단추가 흐려진다(disabled)', () => {
      const { w } = open(false)
      expect(w.find('[data-testid="se-run-open"]').attributes('disabled')).toBeDefined()
      expect(cls(w, 'se-run-open')).toContain('disabled:opacity-50')
      w.unmount()
    })
  })
  it('열린 시나리오가 없으면 불러오기만', () => {
    const w = mountBar()
    expect(w.find('[data-testid="se-load"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-property"]').exists()).toBe(false)
  })
  it('ID·메일 제목·현재 버전·켜짐·유형·등급·대상 창·경고 수', () => {
    const s = useEditorStore(); s.skeleton = skeleton()
    const text = mountBar().text()
    for (const v of ['SEWCVD-SEWMODELA-X', '메일 제목', '240분', '현재 버전', '켜짐', '알람자동조치', '등급 A', '전처리: 대상 창 없음 · 숨길 창 0', '경고 1', '알림 1'])
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
  it('[운영 속성 전체] 로 운영 속성 창을 연다(작업본이 없는 뼈대는 뼈대 값 — 비표준 우선순위·후속·심의 메모·연 생산 LOSS 감소)', async () => {
    const s = useEditorStore(); s.skeleton = skeleton()
    const w = mountBar()
    await w.find('[data-testid="se-property"]').trigger('click')
    const text = w.text()
    for (const v of [MESSAGES.SEW_PROP_CURRENT, '1·5·10', 'NEXT_SC', '심의 메모', '연 생산 LOSS 감소', '42']) expect(text).toContain(v)
    expect(text).not.toContain('글라스 손실')
  })
  it('운영 속성 창에서 [적용] 한 켜짐·유형을 바가 따라간다(작업본 값)', async () => {
    const f = panelFixture([noneStep(0)])
    f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '', timeoutLimit: '1', targetWindow: null }, property: { IsEnabled: true, Type: 1 }, performance: null }
    f.e.session = { ...f.e.session, working: { ...f.e.session.working, property: { IsEnabled: true, Type: 1 } } }
    const w = mountBar()
    expect(w.text()).toContain('켜짐')
    expect(f.e.applyProperty({ IsEnabled: false, Type: 3 })).toBe(true)
    await w.vm.$nextTick()
    expect(w.text()).toContain('꺼짐')
    expect(w.text()).toContain('설비 컨디션유지') // 유형 이름은 운영 속성 창과 같은 표
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
      await new Promise((r) => setTimeout(r, 0))
      const flow = useSaveFlow()
      expect(flow.stage).toBe('form') // 창이 정말 열렸다
      expect(flow.close()).toBe(true)
      expect(flow.stage).toBe(null)
      await w.vm.$nextTick()
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
  describe('[새 시나리오](P2-D Task 6)', () => {
    const find = (w, id) => w.find(`[data-testid="${id}"]`)
    it('쓰기 권한이 있으면 열린 시나리오가 없어도 보이고, 바 버튼 순서는 불러오기 · 새 시나리오 · 저장 — 누르면 new', async () => {
      const f = panelFixture([noneStep(0)])
      f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '', timeoutLimit: '1', targetWindow: null }, property: null, performance: null }
      const w = mount(ScenarioBar, { global: { stubs: { ModalShell: ModalStub } } })
      const ids = w.findAll('button').map((b) => b.attributes('data-testid')).filter((id) => ['se-load', 'se-new', 'se-save'].includes(id))
      expect(ids).toEqual(['se-load', 'se-new', 'se-save'])
      expect(find(w, 'se-new').text()).toBe(t('SEW_NEW_OPEN'))
      await find(w, 'se-new').trigger('click')
      expect(w.emitted('new')).toHaveLength(1)
      w.unmount()
      setActivePinia(createPinia())
      useEditorStore().me = { singleid: 'u', canWrite: true }
      expect(find(mountBar(), 'se-new').exists()).toBe(true)
    })
    it('쓰기 권한이 없으면 없다', () => {
      useEditorStore().me = { singleid: 'u', canWrite: false }
      expect(find(mountBar(), 'se-new').exists()).toBe(false)
    })
    it('새 시나리오 세션은 "아직 저장한 적 없음"(버전 태그 대신)·켜짐·유형을 보이고, 만든 뒤 바꾼 메일 제목은 저장 전 1곳·바뀜 표시', async () => {
      const s = useEditorStore()
      s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }
      const e = useEditStore()
      e.beginNew({ process: 'P', model: 'M2', name: 'NEW_ONE', type: 3, description: '새 메일', timeoutLimit: '240' })
      const w = mountBar()
      expect(find(w, 'se-bar-id').text()).toBe('P-M2-NEW_ONE')
      expect(find(w, 'se-bar-version').text()).toBe(t('SEW_BAR_NEVER_SAVED'))
      expect(find(w, 'se-bar-version').attributes('title')).toBe(t('SEW_BAR_NEVER_SAVED_TITLE'))
      expect(w.text()).toContain('켜짐')
      expect(w.text()).not.toContain(t('SEW_UI_CURRENT_VERSION'))
      expect(find(w, 'se-bar-unsaved').exists()).toBe(false)
      expect(find(w, 'se-bar-description').classes()).not.toContain('border-amber-400')
      e.setHeader('description', '고친 메일')
      await w.vm.$nextTick()
      expect(find(w, 'se-bar-unsaved').text()).toContain('저장 전 1곳')
      expect(find(w, 'se-bar-description').classes()).toContain('border-amber-400')
    })
  })

  describe('불러오기 창에서 연 세션의 표시(P2-D Task 7)', () => {
    const find = (w, id) => w.find(`[data-testid="${id}"]`)
    const versionOf = (crtime, head, desc = 'm') => {
      const st = noneStep(0, { descriptionToEmail: desc })
      const edited = { source: { process: 'P', model: 'M', name: 'N', crtime, fileId: `F${crtime}` }, headCrtime: head, header: { description: 'm', timeoutLimit: '1' }, steps: [st], property: { IsEnabled: true, Type: 1 } }
      return { process: 'P', model: 'M', name: 'N', id: 'P-M-N', headCrtime: head, propertyRev: 'r', version: { crtime, isCurrent: crtime === head, fileId: `F${crtime}` },
        header: { description: 'm', timeoutLimit: 1, targetWindow: null }, property: { IsEnabled: true, Type: 1 }, performance: null, notes: [], steps: [{ ...st, no: 1, notes: [] }], edited }
    }
    const start = () => { const s = useEditorStore(); s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }; return useEditStore() }
    it('되돌려 연 작업본: "옛 버전 … 에서 되돌림" 과 현재 버전', () => {
      const e = start()
      e.beginRestore(versionOf(1730000000000, 1731000000000, '옛'), versionOf(1731000000000, 1731000000000))
      const w = mountBar()
      expect(find(w, 'se-bar-restored').text()).toBe(t('SEW_BAR_RESTORED', { at: formatCrtime(1730000000000) }))
      expect(find(w, 'se-bar-version').text()).toContain(t('SEW_UI_CURRENT_VERSION'))
    })
    it('초안으로 연 세션: 버전 태그는 "시작한 버전", 초안 시작 뒤 새 버전이 있으면 그 태그', () => {
      const e = start()
      const base = versionOf(1730000000000, 1731000000000)
      e.beginFromDraft({ draftId: 'd1', savedAt: '2026-11-07T05:23:51.000Z', base: { crtime: 1730000000000, fileId: 'F1730000000000' }, headCrtime: 1730000000000, propertyRev: 'r',
        target: { model: 'M', name: 'N' }, scenario: base.edited, imageUrls: {}, process: 'P', model: 'M', name: 'N' }, base)
      const w = mountBar()
      expect(find(w, 'se-bar-version').text()).toContain(t('SEW_BAR_DRAFT_BASE'))
      expect(find(w, 'se-bar-draft-stale').text()).toBe(t('SEW_BAR_DRAFT_STALE'))
      expect(find(w, 'se-bar-draft').exists()).toBe(true)
    })
    it('지워진 시나리오: "지워짐"·"읽기 전용" 태그, [저장]·바 칸 입력이 없다', async () => {
      const e = start()
      const sk = versionOf(1731000000000, 1731000000000)
      useEditorStore().skeleton = sk
      e.begin(sk, useEditorStore().me)
      const w = mountBar()
      expect(find(w, 'se-save').exists()).toBe(true)
      e.markDeleted(); await w.vm.$nextTick()
      expect(find(w, 'se-bar-deleted').text()).toContain(t('SEW_BAR_DELETED'))
      expect(find(w, 'se-save').exists()).toBe(false)
      expect(find(w, 'se-bar-fields').exists()).toBe(false)
    })
  })
})
