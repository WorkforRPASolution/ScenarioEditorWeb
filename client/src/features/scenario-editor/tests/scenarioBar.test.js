import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ScenarioBar from '../components/ScenarioBar.vue'
import { useEditorStore } from '../stores/editorStore'

const ModalStub = { name: 'ModalShell', props: ['modelValue', 'title'], template: '<div v-if="modelValue" :data-title="title"><slot /></div>' }
const skeleton = (over = {}) => ({
  process: 'SEWCVD', model: 'SEWMODELA', name: 'X', id: 'SEWCVD-SEWMODELA-X', version: { crtime: 1730000000000, isCurrent: true },
  header: { description: '메일 제목', timeoutLimit: 240, targetWindow: { agentFinds: false, matchMode: null, reasonCode: 'TEXT_EMPTY', inHouseShowsSet: true, raw: { Text: null, ClassName: null } } },
  property: { IsEnabled: true, Type: 1, Priority: 3, Owners: ['a@2026-11-01 10:00:00'], ScenarioTriggerType: 0, StartDelay: 0, RetryCnt: 0, RetryInterval: 10,
    NextScenarioIfSuccess: null, NextScenarioIfFail: { Name: 'NEXT_SC', Text: 't' }, DetailedDescriptionTitle: '', DetailedDescription: '', DescriptionFromDonductor: '', EDMLink: '',
    ExecutingLevel: 0, IsShowDialog: true, LcncType: 0, LowcodeExtension: '', DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: false, DoNotSendEmailWhenFail: false, ID: 'X' },
  performance: { gradeName: 'A', supervisor: 'Not entered', supervisorNotEntered: true, scenarioDescription: '설명', rawKeys: ['Grade'], eqpPerformanceLoss: 0, glassLoss: 0 },
  steps: [{ uid: 's0', no: 1, notes: [{ level: 'warning', code: 'X' }] }], notes: [{ level: 'info', code: 'TARGET_WINDOW_DIFFERS' }], ...over
})

describe('ScenarioBar', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const mountBar = () => mount(ScenarioBar, { global: { stubs: { ModalShell: ModalStub } } })

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
})
