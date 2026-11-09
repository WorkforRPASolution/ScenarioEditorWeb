import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ list: vi.fn(), saveReview: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import PropertyDialog from '../components/PropertyDialog.vue'
import { t } from '../messages'
import { unsavedChanges } from '../editor/diff'
import { buildMeta } from '../editor/request'
import { panelFixture, noneStep } from './panelFixture'

const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code) => Promise.reject({ response: { status, data: { code } }, request: {} })
// 창은 실제 Teleport 로 body 에 그린다 — 시험 기본값(Teleport 대역)은 ModalShell 이 다시 그릴 때(가운데로 옮기기·닫기 처리기 등)
// 창 안쪽을 새로 만들어 초점·심의 글 같은 창 안 상태를 잃는다(실제 Teleport 는 그대로다). 그래서 문서에서 찾는다.
const q = (sel) => { const el = document.querySelector(sel); return el ? new DOMWrapper(el) : { exists: () => false } }
const qa = (sel) => [...document.querySelectorAll(sel)].map((el) => new DOMWrapper(el))
const find = (_w, id) => q(`[data-testid="${id}"]`)
const field = (_w, f) => q(`[data-pfield="${f}"]`)
const dlgText = () => document.querySelector('[data-testid="se-property-dialog"]')?.textContent ?? ''

// 서버 propertyFromBson·performanceFromBson 모양(목업 v2 의 시연 값)
const PROP = {
  ID: 'P-M-N', Owners: ['lee_eng@2026-09-17 09:22:00', 'hong_eng@2026-10-28 14:01:00'], ScenarioTriggerType: 0,
  DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: true, DoNotSendEmailWhenFail: false,
  StartDelay: 30, RetryCnt: 3, RetryInterval: 60,
  NextScenarioIfSuccess: { Name: 'CHAMBER_LEAK_CHECK', Text: '조치 뒤 누설 확인' }, NextScenarioIfFail: { Name: '', Text: '' },
  Type: 1, DetailedDescriptionTitle: '', DetailedDescription: '', DescriptionFromConductor: '심의 메모', EDMLink: '',
  IsEnabled: true, ExecutingLevel: 0, IsShowDialog: true, Priority: 5, LcncType: 0, LowcodeExtension: ''
}
const PERF = {
  group: 'CVD', trigger: 1, triggerName: 'Log', triggerInfo: 'E1234', grade: 2, gradeName: 'A', supervisor: 'kim_conductor', supervisorNotEntered: false,
  supervisorComment: '재발률이 낮아 A 로 판단', citizenDevelopers: [{ knoxId: 'minsu.park', sdwt: 'CVD1', name: '박민수', contribution: 60 }],
  performType: 1, performTypeName: 'Active', scenarioDescription: 'E1234 알람 때 펌프를 초기화한다', manWorkLoss: 9000, eqpPerformanceLoss: 5400,
  eqpStopLoss: 18000, waferLoss: 0, investCostLoss: 120, additionalEffect: '야간 호출 감소', accidentType: 0, accidentTypeName: 'None', accidentInfo: '',
  updateDate: '2026-10-28', rawKeys: ['Group', 'Grade']
}
const NAMES = [{ name: 'N' }, { name: 'CHAMBER_LEAK_CHECK' }, { name: 'PUMP_RESTART' }]

let w = null
function setup({ me = {}, property = PROP, performance = PERF, fresh = false, canWrite = true, isCurrent = true, props = {} } = {}) {
  const f = panelFixture([noneStep(0)], { canWrite, isCurrent, me: { singleid: 'choi_conductor', authorityManager: 2, ...me } })
  f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', property, performance }
  const working = { ...f.e.session.working, property: property ?? {} }
  f.e.session = { ...f.e.session, working, saveBase: working, ...(fresh ? { source: null } : {}) }
  api.list.mockReturnValue(ok(NAMES))
  w = mount(PropertyDialog, { props: { modelValue: true, ...props }, attachTo: document.body, global: { stubs: { teleport: false } } })
  return { ...f, w }
}
async function startEdit() {
  await find(w, 'se-prop-edit').trigger('click')
}

describe('운영 속성 창(PropertyDialog)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((fn) => fn.mockReset())
  })
  afterEach(() => { if (w) w.unmount(); w = null })

  it('보기: 실행 경로(시작 지연·재시도·메일·후속)와 현재 값 안내 — 저장된 빈 후속은 "여기서 끝"', async () => {
    setup()
    await flushPromises()
    const text = dlgText()
    for (const v of [t('SEW_PROP_CURRENT'), '켜짐', '알람자동조치', '30초 뒤', '3번 더, 1분 간격', 'CHAMBER_LEAK_CHECK', '조치 뒤 누설 확인', '메일 보냄', '안 보냄', '여기서 끝'])
      expect(text).toContain(v)
    expect(find(w, 'se-prop-edit').exists()).toBe(true)
    expect(find(w, 'se-prop-apply').exists()).toBe(false)
    expect(api.list).toHaveBeenCalledWith('P', 'M')
  })

  it('보기: 성과 줄은 공수 Loss·설비 정지 Loss·Wafer·투자비, 심의·원개발자·수정 이력(최근 먼저)·그 밖의 값', async () => {
    setup()
    await flushPromises()
    const m = find(w, 'se-prop-metrics').text()
    for (const v of ['공수 Loss', '2시간 30분', '설비 정지 Loss', '5시간', 'Wafer', '없음', '투자비', '120']) expect(m).toContain(v)
    for (const v of ['인력 손실', '웨이퍼 손실', '설비 성능 손실']) expect(dlgText()).not.toContain(v)
    const text = dlgText()
    for (const v of ['A', '심의자 kim_conductor', '재발률이 낮아 A 로 판단', '박민수', '60%', '야간 호출 감소', '심의 메모', 'E1234']) expect(text).toContain(v)
    expect(text.indexOf('hong_eng')).toBeLessThan(text.indexOf('lee_eng'))
  })

  it('보기: 1·5·10 이 아닌 우선순위는 저장 값 그대로 알리고, 심의자가 없으면 "아직 심의하지 않았습니다"', async () => {
    setup({ property: { ...PROP, Priority: 3 }, performance: { ...PERF, supervisor: 'Not entered', supervisorNotEntered: true, supervisorComment: '' } })
    await flushPromises()
    expect(dlgText()).toContain('1·5·10')
    expect(dlgText()).toContain(t('SEW_PROP_NOT_REVIEWED'))
  })

  it('운영 속성을 해석하지 못했으면 그 사실만 — [수정] 없음', () => {
    setup({ property: null })
    expect(dlgText()).toContain(t('SEW_UI_PROPERTY_PARSE_FAILED'))
    expect(find(w, 'se-prop-edit').exists()).toBe(false)
  })

  it('쓰기 권한이 없거나 옛 버전이면 [수정] 이 없다', () => {
    setup({ canWrite: false })
    expect(find(w, 'se-prop-edit').exists()).toBe(false)
    w.unmount(); setActivePinia(createPinia())
    setup({ isCurrent: false })
    expect(find(w, 'se-prop-edit').exists()).toBe(false)
  })

  it('시작 지연 5 → 칸 오류, [적용] 막힘, 바닥 줄 "고칠 곳 1개"', async () => {
    setup()
    await startEdit()
    await field(w, 'StartDelay').setValue('5')
    expect(find(w, 'se-prop-err-StartDelay').text()).toBe(t('RULE_START_DELAY_RANGE'))
    expect(find(w, 'se-prop-apply').attributes('disabled')).toBeDefined()
    expect(find(w, 'se-prop-foot').text()).toContain(t('SEW_PROP_FIX_N', { n: 1 }))
    await field(w, 'StartDelay').setValue('0')
    expect(find(w, 'se-prop-err-StartDelay').exists()).toBe(false)
    expect(find(w, 'se-prop-apply').attributes('disabled')).toBeUndefined()
  })

  it('[적용] 은 작업본 property 에만(바뀐 칸만, 저장된 빈 후속 그대로) — 저장 전 변경에 운영 속성 행, 다른 시나리오를 열면 묻는다', async () => {
    const { e } = setup()
    await startEdit()
    expect(find(w, 'se-prop-apply').attributes('disabled')).toBeDefined() // 바뀐 것이 없다
    await field(w, 'StartDelay').setValue('120')
    expect(find(w, 'se-prop-foot').text()).toContain('시작 지연 30초 → 2분')
    await find(w, 'se-prop-apply').trigger('click')
    const p = e.session.working.property
    expect(p).toEqual({ ...PROP, StartDelay: 120 })
    expect(p.NextScenarioIfFail).toEqual({ Name: '', Text: '' })
    expect(e.session.saveBase.property).toBe(PROP)
    expect(buildMeta(e.session).meta.scenario.property).toEqual({ ...PROP, StartDelay: 120 }) // 배포·초안 요청이 싣는다
    expect(unsavedChanges(e.session.working, e.session.saveBase)).toContainEqual({ kind: 'field', key: 'property', keys: ['StartDelay'] })
    expect(e.toast.text).toBe(t('SEW_PROP_APPLIED'))
    // 보기로 돌아와 "아직 배포 전" 표시
    expect(find(w, 'se-prop-apply').exists()).toBe(false)
    expect(find(w, 'se-prop-pending').text()).toBe(t('SEW_PROP_PENDING', { n: 1 }))
    expect(dlgText()).toContain('2분 뒤')
    const next = vi.fn()
    expect(e.askLeave(next)).toBe(false)
    expect(e.dialog).toEqual({ kind: 'leave', n: 1 })
    expect(next).not.toHaveBeenCalled()
  })

  it('[취소] 는 고친 값을 버리고 보기로', async () => {
    const { e } = setup()
    await startEdit()
    await find(w, 'se-prop-onoff').trigger('click')
    expect(find(w, 'se-prop-foot').text()).toContain('상태 켜짐 → 꺼짐')
    await find(w, 'se-prop-cancel').trigger('click')
    expect(e.session.working.property).toBe(PROP)
    expect(dlgText()).toContain('켜짐')
    expect(find(w, 'se-prop-pending').exists()).toBe(false)
  })

  it('후속 고르기는 같은 모델 이름 목록(자기 자신 빼고) — 잇고 설명을 넣어 적용, 빼면 null', async () => {
    const { e } = setup()
    await flushPromises()
    await startEdit()
    await field(w, 'NextScenarioIfFail').trigger('click') // + 다음 시나리오 잇기
    const sel = field(w, 'NextScenarioIfFail.Name')
    expect(sel.findAll('option').map((o) => o.text())).toEqual([t('SEW_PROP_PICK'), 'CHAMBER_LEAK_CHECK', 'PUMP_RESTART'])
    await sel.setValue('PUMP_RESTART')
    expect(find(w, 'se-prop-err-NextScenarioIfFail.Text').text()).toBe(t('RULE_FOLLOW_DESC_SHORT'))
    await field(w, 'NextScenarioIfFail.Text').setValue('펌')
    expect(find(w, 'se-prop-err-NextScenarioIfFail.Text').exists()).toBe(true)
    await field(w, 'NextScenarioIfFail.Text').setValue('펌프 재시작')
    expect(find(w, 'se-prop-err-NextScenarioIfFail.Text').exists()).toBe(false)
    await find(w, 'se-prop-apply').trigger('click')
    expect(e.session.working.property.NextScenarioIfFail).toEqual({ Name: 'PUMP_RESTART', Text: '펌프 재시작' })
    // 성공 쪽을 빼고 다시 이으면 이름·설명이 비어 막히고, 다시 빼면 null 로 적용
    await startEdit()
    await find(w, 'se-prop-unlink-NextScenarioIfSuccess').trigger('click')
    await field(w, 'NextScenarioIfSuccess').trigger('click')
    expect(find(w, 'se-prop-err-NextScenarioIfSuccess.Name').text()).toBe(t('RULE_FOLLOW_NAME_REQUIRED'))
    expect(find(w, 'se-prop-apply').attributes('disabled')).toBeDefined()
    await find(w, 'se-prop-unlink-NextScenarioIfSuccess').trigger('click')
    expect(find(w, 'se-prop-foot').text()).toContain('성공 후속 CHAMBER_LEAK_CHECK → 없음')
    await find(w, 'se-prop-apply').trigger('click')
    expect(e.session.working.property.NextScenarioIfSuccess).toBeNull()
  })

  it('목록에 없는 후속은 "이제 없음" 으로 알리되 막지 않는다', async () => {
    setup({ property: { ...PROP, NextScenarioIfSuccess: { Name: 'DELETED_SC', Text: '옛 후속' } } })
    await flushPromises()
    expect(dlgText()).toContain(t('SEW_PROP_FOLLOW_GONE_TAG'))
    await startEdit()
    expect(dlgText()).toContain(t('SEW_PROP_FOLLOW_GONE'))
    expect(field(w, 'NextScenarioIfSuccess.Name').element.value).toBe('DELETED_SC')
  })

  it('관리 등급 3(Manager)은 심의 칸이 잠기고 [성과 입력] 대신 안내 — 보기에서도 이유를 보인다', async () => {
    setup({ me: { authorityManager: 3 } })
    expect(find(w, 'se-prop-perf-open').exists()).toBe(false)
    expect(find(w, 'se-prop-perf-lock').text()).toBe(t('SEW_PROP_PERF_LOCK'))
    expect(find(w, 'se-prop-review-edit').exists()).toBe(false)
    expect(find(w, 'se-prop-review-lock').text()).toBe(t('SEW_PROP_LOCK_GRADE'))
    await startEdit()
    expect(qa('[data-testid="se-prop-grade"]')).toHaveLength(0)
    expect(find(w, 'se-prop-comment').exists()).toBe(false)
    expect(find(w, 'se-prop-review-lock').text()).toBe(t('SEW_PROP_LOCK_GRADE'))
  })

  it('새 시나리오(저장 전)는 등급 칸을 끄고 성과 입력도 저장 뒤로', async () => {
    setup({ fresh: true })
    expect(find(w, 'se-prop-perf-lock').text()).toBe(t('SEW_PROP_PERF_FRESH'))
    expect(find(w, 'se-prop-review-edit').exists()).toBe(false)
    expect(find(w, 'se-prop-review-lock').text()).toBe(t('SEW_PROP_LOCK_FRESH'))
    await startEdit()
    expect(qa('[data-testid="se-prop-grade"]')).toHaveLength(0)
    expect(find(w, 'se-prop-review-lock').text()).toBe(t('SEW_PROP_LOCK_FRESH'))
  })

  // 심의(등급·의견)는 관리 등급 1·2 만 본다 — WRITE·현재 버전·운영 속성 [수정] 과 상관없다(설계 §3, 서버 writePolicy reviewDenial)
  async function reviewAndSave({ grade = 1, comment = '전 공정에 횡전개한다' } = {}) {
    await find(w, 'se-prop-review-edit').trigger('click')
    await q(`[data-testid="se-prop-grade"][data-grade="${grade}"]`).trigger('click')
    await find(w, 'se-prop-comment').setValue(comment)
    const back = { ...PERF, grade, gradeName: 'S', supervisor: 'choi_conductor', supervisorComment: comment }
    api.saveReview.mockReturnValue(ok({ performance: back }))
    await find(w, 'se-prop-review-save').trigger('click')
    await flushPromises()
    return back
  }

  it('[심의 저장](관리 등급 2): [심의 고치기] 로 고쳐 바로 쓰고 서버가 돌려준 값으로 바뀐다 — 바의 등급도, 작업본은 그대로', async () => {
    const { s, e } = setup()
    await find(w, 'se-prop-review-edit').trigger('click')
    expect(find(w, 'se-prop-review-save').attributes('disabled')).toBeDefined()
    await q('[data-testid="se-prop-grade"][data-grade="1"]').trigger('click')
    await find(w, 'se-prop-comment').setValue('짧음')
    expect(dlgText()).toContain(t('RULE_COMMENT_SHORT'))
    expect(find(w, 'se-prop-review-save').attributes('disabled')).toBeDefined()
    await find(w, 'se-prop-comment').setValue('전 공정에 횡전개한다')
    expect(find(w, 'se-prop-review-lock').text()).toBe(t('SEW_PROP_REVIEW_WILL_RECORD'))
    const back = { ...PERF, grade: 1, gradeName: 'S', supervisor: 'choi_conductor', supervisorComment: '전 공정에 횡전개한다' }
    api.saveReview.mockReturnValue(ok({ performance: back }))
    await find(w, 'se-prop-review-save').trigger('click')
    await flushPromises()
    expect(api.saveReview).toHaveBeenCalledWith('P', 'M', 'N', { grade: 1, comment: '전 공정에 횡전개한다' })
    expect(s.skeleton.performance).toEqual(back)
    expect(find(w, 'se-prop-review-msg').text()).toBe(t('SEW_PROP_REVIEW_SAVED'))
    expect(find(w, 'se-prop-supervisor').text()).toBe(t('SEW_PROP_SUPERVISOR', { who: 'choi_conductor' }))
    expect(find(w, 'se-prop-comment').exists()).toBe(false) // 저장하면 심의 고치기를 닫는다
    expect(e.unsavedCount).toBe(0)
  })

  it('WRITE 가 없는 관리 등급 2 도 심의를 저장한다([수정] 은 없다)', async () => {
    const { s } = setup({ canWrite: false })
    expect(find(w, 'se-prop-edit').exists()).toBe(false)
    const back = await reviewAndSave()
    expect(api.saveReview).toHaveBeenCalledWith('P', 'M', 'N', { grade: 1, comment: '전 공정에 횡전개한다' })
    expect(s.skeleton.performance).toEqual(back)
  })

  it('옛 버전을 열어도 관리 등급 1 은 심의를 저장한다(심의는 시나리오 단위)', async () => {
    setup({ isCurrent: false, me: { authorityManager: 1 } })
    expect(find(w, 'se-prop-edit').exists()).toBe(false)
    await reviewAndSave({ grade: 2, comment: '옛 버전에서 심의' })
    expect(api.saveReview).toHaveBeenCalledWith('P', 'M', 'N', { grade: 2, comment: '옛 버전에서 심의' })
  })

  it('운영 속성 [적용]·[취소] 는 저장하지 않은 심의 글을 지우지 않는다', async () => {
    const { e } = setup()
    await find(w, 'se-prop-review-edit').trigger('click')
    await find(w, 'se-prop-comment').setValue('아직 저장 안 한 의견')
    await startEdit()
    await field(w, 'StartDelay').setValue('120')
    await find(w, 'se-prop-apply').trigger('click')
    expect(e.session.working.property.StartDelay).toBe(120)
    expect(find(w, 'se-prop-comment').element.value).toBe('아직 저장 안 한 의견')
    await startEdit()
    await find(w, 'se-prop-cancel').trigger('click')
    expect(find(w, 'se-prop-comment').element.value).toBe('아직 저장 안 한 의견')
    await find(w, 'se-prop-review-cancel').trigger('click')
    expect(find(w, 'se-prop-comment').exists()).toBe(false)
  })

  it('손대지 않은 저장 심의(등급 A·의견 없음)는 빨갛게 보이지 않고, 등급을 바꾸면 의견 5자를 요구한다', async () => {
    setup({ performance: { ...PERF, supervisorComment: '' } })
    await find(w, 'se-prop-review-edit').trigger('click')
    expect(dlgText()).not.toContain(t('RULE_COMMENT_SHORT'))
    await q('[data-testid="se-prop-grade"][data-grade="3"]').trigger('click')
    expect(dlgText()).toContain(t('RULE_COMMENT_SHORT'))
    expect(find(w, 'se-prop-review-save').attributes('disabled')).toBeDefined()
  })

  it('[심의 저장] 실패는 code 문구로 알리고 고친 값은 남긴다', async () => {
    setup()
    await find(w, 'se-prop-review-edit').trigger('click')
    await q('[data-testid="se-prop-grade"][data-grade="6"]').trigger('click')
    api.saveReview.mockReturnValue(fail(403, 'GRADE_FORBIDDEN'))
    await find(w, 'se-prop-review-save').trigger('click')
    await flushPromises()
    expect(find(w, 'se-prop-review-msg').text()).toContain(t('SEW_ERR_GRADE_FORBIDDEN'))
    expect(q('[data-testid="se-prop-grade"][data-grade="6"]').attributes('aria-checked')).toBe('true')
  })

  describe('닫기 — 적용하지 않은 값이 있으면 묻는다(✕·바깥 누르기 같게)', () => {
    const closeX = () => q('[data-testid="se-property-dialog"] [aria-label="닫기"]').trigger('click')
    const backdrop = () => q('[data-testid="se-property-dialog"] > div').trigger('click')

    it('고친 것이 없으면 바로 닫는다(수정 중이어도)', async () => {
      setup()
      await closeX()
      expect(w.emitted('update:modelValue')).toEqual([[false]])
      w.unmount(); setActivePinia(createPinia())
      setup()
      await startEdit()
      await backdrop()
      expect(w.emitted('update:modelValue')).toEqual([[false]])
    })

    it('적용하지 않은 운영 속성: 바깥을 눌러도 닫지 않고 묻는다 — [계속 고치기] 는 그대로, [버리고 닫기] 는 닫는다', async () => {
      const { e } = setup()
      await startEdit()
      await field(w, 'StartDelay').setValue('120')
      await backdrop()
      expect(w.emitted('update:modelValue')).toBeUndefined()
      expect(find(w, 'se-prop-leave').text()).toContain(t('SEW_PROP_LEAVE_PROPERTY', { n: 1 }))
      await find(w, 'se-prop-leave-keep').trigger('click')
      expect(find(w, 'se-prop-leave').exists()).toBe(false)
      expect(field(w, 'StartDelay').element.value).toBe('120')
      await closeX()
      expect(find(w, 'se-prop-leave').exists()).toBe(true)
      await find(w, 'se-prop-leave-drop').trigger('click')
      expect(w.emitted('update:modelValue')).toEqual([[false]])
      expect(e.session.working.property).toBe(PROP) // 적용하지 않았으니 작업본은 그대로
    })

    it('저장하지 않은 심의 글도 묻고, Esc 는 [계속 고치기]', async () => {
      setup({ canWrite: false })
      await find(w, 'se-prop-review-edit').trigger('click')
      await find(w, 'se-prop-comment').setValue('저장 안 한 의견')
      await closeX()
      expect(find(w, 'se-prop-leave').text()).toContain(t('SEW_PROP_LEAVE_REVIEW'))
      expect(find(w, 'se-prop-leave').text()).not.toContain(t('SEW_PROP_LEAVE_PROPERTY', { n: 1 }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await w.vm.$nextTick()
      expect(find(w, 'se-prop-leave').exists()).toBe(false)
      expect(find(w, 'se-prop-comment').element.value).toBe('저장 안 한 의견')
      expect(w.emitted('update:modelValue')).toBeUndefined()
    })
  })

  it('[성과 입력](관리 등급 1·2)은 부모에 알린다 — 보기에서도', async () => {
    setup({ me: { authorityManager: 1 } })
    await find(w, 'se-prop-perf-open').trigger('click')
    expect(w.emitted('open-performance')).toHaveLength(1)
  })

  it('focus 를 주면 수정으로 열고 그 칸에 초점(저장 창의 막힌 줄) — 창이 가운데로 옮겨 다시 그려도 남는다', async () => {
    setup({ props: { modelValue: false } })
    await w.setProps({ modelValue: true, focus: { field: 'StartDelay', n: 1 } })
    await flushPromises()
    expect(document.querySelector('[data-testid="se-prop-editing"]')).not.toBeNull()
    expect(document.activeElement).toBe(document.querySelector('[data-pfield="StartDelay"]'))
  })
  it('데스크탑 칸(ExecutingLevel)에 초점을 주면 접힌 묶음을 편다', async () => {
    setup({ props: { modelValue: false } })
    await w.setProps({ modelValue: true, focus: { field: 'ExecutingLevel', n: 1 } })
    await flushPromises()
    expect(document.querySelector('details.se-pp-more').open).toBe(true)
    expect(document.activeElement).toBe(document.querySelector('[data-pfield="ExecutingLevel"]'))
  })
})
