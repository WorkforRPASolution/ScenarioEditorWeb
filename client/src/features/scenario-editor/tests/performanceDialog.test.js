import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({
  list: vi.fn(), saveReview: vi.fn(), savePerformance: vi.fn(), sameName: vi.fn(), searchUsers: vi.fn(), registeredUsers: vi.fn(),
  check: vi.fn(), nameRule: vi.fn()
}))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import PerformanceDialog from '../components/PerformanceDialog.vue'
import ScenarioBar from '../components/ScenarioBar.vue'
import { t, MESSAGES } from '../messages'
import { panelFixture, noneStep } from './panelFixture'

const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code, details) => Promise.reject({ response: { status, data: { code, details } }, request: {} })
// 창은 실제 Teleport 로 body 에 그린다(운영 속성 창 시험과 같은 이유 — 시험 기본 대역은 ModalShell 이 다시 그릴 때 창 안 상태를 잃는다).
const q = (sel) => { const el = document.querySelector(sel); return el ? new DOMWrapper(el) : { exists: () => false } }
const qa = (sel) => [...document.querySelectorAll(sel)].map((el) => new DOMWrapper(el))
const id = (v) => q(`[data-testid="${v}"]`)
const pf = (v) => q(`[data-pf="${v}"]`)
const dlg = () => document.querySelector('[data-testid="se-perf-dialog"]')
const dlgText = () => dlg()?.textContent ?? ''
const errAt = (at) => id(`se-perf-err-${at}`)

// 서버 performanceFromBson 모양(목업 "기본" 상황)
const PERF = {
  group: '', trigger: 1, triggerName: 'Log', triggerInfo: 'E1234', grade: 2, gradeName: 'A', supervisor: 'kim_conductor', supervisorNotEntered: false,
  supervisorComment: '재발률이 낮고 조치 범위가 좁아 A 로 판단',
  citizenDevelopers: [{ knoxId: 'minsu.park', sdwt: '', name: '박민수', contribution: 60 }, { knoxId: 'seoyeon.lee', sdwt: '', name: '이서연', contribution: 40 }],
  performType: 1, performTypeName: 'Active', scenarioDescription: 'E1234 알람 때 진공 펌프를 초기화한다', manWorkLoss: 90, eqpPerformanceLoss: 0,
  eqpStopLoss: 300, waferLoss: 0, investCostLoss: 120, additionalEffect: '야간 호출 감소', accidentType: 0, accidentTypeName: 'None', accidentInfo: '',
  updateDate: '2026-10-28', rawKeys: []
}
const EMPTY = {
  ...PERF, group: '', trigger: 0, triggerName: 'NA', triggerInfo: null, grade: 0, gradeName: 'N/A', supervisor: 'Not entered', supervisorNotEntered: true, supervisorComment: '',
  citizenDevelopers: [], performType: 0, performTypeName: 'None', scenarioDescription: '', manWorkLoss: 0, eqpStopLoss: 0, investCostLoss: 0, additionalEffect: '', updateDate: ''
}
const USERS = { 'minsu.park': { singleid: 'minsu.park', name: '박민수', process: 'CVD' }, 'seoyeon.lee': { singleid: 'seoyeon.lee', name: '이서연', process: 'CVD' } }

let w = null
function setup({ performance = PERF, me = {}, canWrite = true, same = ['M', 'MODEL_B', 'MODEL_C'], registered = Object.keys(USERS) } = {}) {
  const f = panelFixture([noneStep(0)], { canWrite, me: { singleid: 'choi_conductor', authorityManager: 2, ...me } })
  f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', property: {}, performance }
  api.sameName.mockReturnValue(ok(same))
  api.registeredUsers.mockImplementation((ids) => ok(ids.filter((i) => registered.includes(i)).map((i) => USERS[i])))
  w = mount(PerformanceDialog, { props: { modelValue: true }, attachTo: document.body, global: { stubs: { teleport: false } } })
  return f
}
const footText = () => id('se-perf-foot').text()
// 바(ScenarioBar)가 그리는 머리 정보
const HEADER = { description: '', timeoutLimit: '240', targetWindow: { agentFinds: false, matchMode: null, reasonCode: 'TEXT_EMPTY', inHouseShowsSet: true, raw: { Text: null, ClassName: null } } }
const saveBtn = () => id('se-perf-save')

describe('성과 입력 창(PerformanceDialog)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((fn) => fn.mockReset())
  })
  afterEach(() => { if (w) w.unmount(); w = null; vi.useRealTimers() })

  it('열면: 심의 띠·성과·원개발자·같은 이름 모델(자기 모델 빼고, 아무것도 고르지 않음) — 완료 칩, 저장 버튼은 꺼짐', async () => {
    setup()
    await flushPromises()
    expect(api.sameName).toHaveBeenCalledWith('P', 'N')
    expect(api.registeredUsers).toHaveBeenCalledWith(['minsu.park', 'seoyeon.lee'])
    expect(id('se-perf-done').text()).toBe('완료')
    for (const v of ['심의', t('SEW_PERF_REVIEW_HELP'), 'kim_conductor', '성과', 'Active', 'Passive', '공수절감', '정지LOSS 개선', '연 생산 LOSS 감소', '연 투자비 절감', '원개발자', '박민수', '이서연', '합계 100%'])
      expect(dlgText()).toContain(v)
    expect(pf('also:MODEL_B').exists()).toBe(true)
    expect(pf('also:M').exists()).toBe(false)
    expect(pf('also:MODEL_B').element.checked).toBe(false)
    expect(pf('effv:ManWorkLoss').element.value).toBe('90')
    expect(pf('effon:WaferLoss').element.checked).toBe(false)
    expect(pf('effv:WaferLoss').attributes('disabled')).toBeDefined()
    expect(dlgText()).toContain('1시간 30분')
    expect(dlgText()).toContain(t('SEW_PERF_FOOT_IDLE'))
    expect(dlgText()).toContain('2026-10-28')
    expect(saveBtn().attributes('disabled')).toBeDefined()
    expect(dlgText()).not.toContain('설비 성능 Loss') // EqpPerfornmanceLoss 칸은 없다
  })

  it('저장된 원개발자 중 등록 안 된 사람은 열 때 "등록 안 됨" — 고치지 않으면 경고만, 고치면 DEV_UNKNOWN 으로 막는다', async () => {
    setup({ registered: ['minsu.park'] })
    await flushPromises()
    const rows = qa('[data-testid="se-perf-dev"]')
    expect(rows[1].text()).toContain(t('SEW_PERF_DEV_UNREG_TAG'))
    expect(rows[0].text()).not.toContain(t('SEW_PERF_DEV_UNREG_TAG'))
    expect(dlgText()).toContain(t('SEW_PERF_DEV_WARN_UNREG'))
    expect(errAt('dev:1').exists()).toBe(false)
    await pf('devp:0').setValue('50')
    expect(errAt('dev:1').text()).toContain(t('RULE_DEV_UNKNOWN'))
    expect(saveBtn().attributes('disabled')).toBeDefined()
  })

  it('의견 4자 → COMMENT_SHORT(손댄 칸만 빨강), [성과 저장] 꺼짐, 바닥 "고칠 곳 1개" — 칸 이름을 누르면 그 칸으로', async () => {
    setup()
    await flushPromises()
    expect(errAt('comment').exists()).toBe(false)
    await pf('comment').setValue('좋음입니')
    expect(errAt('comment').text()).toBe(t('RULE_COMMENT_SHORT'))
    expect(pf('comment').classes()).toContain('bad')
    expect(saveBtn().attributes('disabled')).toBeDefined()
    expect(footText()).toContain(t('SEW_PERF_FIX_N', { n: 1 }))
    pf('desc').element.focus()
    await q('[data-goto="comment"]').trigger('click')
    expect(document.activeElement).toBe(pf('comment').element)
    await pf('comment').setValue('좋음입니다')
    expect(errAt('comment').exists()).toBe(false)
    expect(saveBtn().attributes('disabled')).toBeUndefined()
  })

  it('새로 입력(빈 성과): 손대기 전에는 빨간 오류 없이 바닥 "채울 곳 4개", 효과 유형은 Active 로 골라 둔다', async () => {
    setup({ performance: EMPTY })
    await flushPromises()
    expect(id('se-perf-done').text()).toBe('미완료')
    expect(id('se-perf-missing').text()).toContain('등급 · 트리거 · 효과나 사고 유형')
    expect(qa('.se-pf-err').length).toBe(0)
    expect(footText()).toContain(t('SEW_PERF_NEED_N', { n: 4 }))
    expect(pf('type:1').attributes('aria-checked')).toBe('true')
    expect(footText()).toContain('트리거, 등급, 심사 의견, 효과나 사고 유형')
    expect(saveBtn().attributes('disabled')).toBeDefined()
  })

  it('Passive 면 그룹 칸(입력은 대문자로), Active 면 숨김', async () => {
    setup()
    await flushPromises()
    expect(pf('group').exists()).toBe(false)
    await pf('type:2').trigger('click')
    expect(pf('group').exists()).toBe(true)
    await pf('group').setValue('cvd-pump')
    expect(pf('group').element.value).toBe('CVD-PUMP')
    expect(errAt('group').text()).toBe(t('RULE_GROUP_FORMAT'))
    await pf('group').setValue('cvd_pump')
    expect(errAt('group').exists()).toBe(false)
    await pf('type:1').trigger('click')
    expect(pf('group').exists()).toBe(false)
  })

  // 사내 기여 창 문구(42 Q-121 답 2026-11-09). 사내 창은 입력값을 그대로 저장한다 — 공수·정지 값은 분이다(초가 아님).
  it('효과 단위는 사내 기여 창 문구 — 공수절감 분(Passive 면 분/일), 정지LOSS 개선 분/일, 연 생산 LOSS 감소 매, 연 투자비 절감 KRW 1,000,000', async () => {
    setup()
    await flushPromises()
    const unit = (k) => pf(`effv:${k}`).element.parentElement.querySelector('.u').textContent.trim()
    expect(unit('ManWorkLoss')).toBe('분 · 1시간 30분')
    expect(unit('EqpStopLoss')).toBe('분/일 · 5시간')
    expect(unit('WaferLoss')).toBe('매')
    expect(unit('InvestCostLoss')).toBe('KRW 1,000,000')
    await pf('type:2').trigger('click')
    expect(unit('ManWorkLoss')).toBe('분/일 · 1시간 30분')
    expect(unit('EqpStopLoss')).toBe('분/일 · 5시간')
    await pf('effv:ManWorkLoss').setValue('59')
    expect(unit('ManWorkLoss')).toBe('분/일')
  })

  it('고치지 않는 설비 성능 Loss 는 저장 값만 알린다(단위를 단정할 근거가 없음)', async () => {
    setup({ performance: { ...PERF, eqpPerformanceLoss: 90 } })
    await flushPromises()
    expect(dlgText()).toContain(t('SEW_PERF_KEPT_LOSS', { value: '90' }))
    expect(dlgText()).not.toContain('90초')
  })

  it('사고 유형을 바꾸면 사고 정보를 비우고 다시 고르게 한다(값은 Key, 화면은 문구), 옛 값은 글자 그대로', async () => {
    setup({ performance: { ...PERF, accidentType: 1, accidentInfo: '순간정전' } })
    await flushPromises()
    expect(pf('accInfo').element.value).toBe('순간정전')
    expect(dlgText()).toContain(t('SEW_PERF_ACC_OLD'))
    await pf('acc').setValue('2')
    expect(pf('accInfo').element.value).toBe('')
    expect(errAt('accInfo').text()).toBe(t('RULE_ACCIDENT_INFO_REQUIRED'))
    expect(pf('accInfo').text()).toContain('배관 누출 (Pipe)')
    await pf('accInfo').setValue('Pipe')
    expect(errAt('accInfo').exists()).toBe(false)
  })

  it('트리거는 영문 이름 — RV·EqState 는 저장된 값일 때만 고를 수 있다', async () => {
    setup()
    await flushPromises()
    const opt = (v) => q(`[data-pf="trigger"] option[value="${v}"]`)
    expect(opt(1).text()).toBe('Log')
    expect(opt(2).attributes('disabled')).toBeDefined()
    w.unmount(); setActivePinia(createPinia())
    setup({ performance: { ...PERF, trigger: 2, triggerName: 'RV' } })
    await flushPromises()
    expect(opt(2).attributes('disabled')).toBeUndefined()
    expect(opt(3).attributes('disabled')).toBeDefined()
    expect(dlgText()).toContain(t('SEW_PERF_TRIGGER_KEPT', { name: 'RV' }))
  })

  it('원개발자 찾기(2자 이상): 이름·아이디·공정, 이미 넣은 사람은 꺼짐 — 고르면 기여도 빈칸에 초점, 합계 110 → DEV_TOTAL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setup()
    await flushPromises()
    await pf('search').setValue('박')
    expect(id('se-perf-pop').text()).toContain(t('SEW_PERF_SEARCH_SHORT'))
    api.searchUsers.mockReturnValue(ok([{ singleid: 'minsu.park', name: '박민수', process: 'CVD' }, { singleid: 'minsu.park2', name: '박민수', process: 'ETCH' }]))
    await pf('search').setValue('박민')
    expect(id('se-perf-pop').text()).toContain(t('SEW_PERF_SEARCHING', { q: '박민' }))
    vi.advanceTimersByTime(400)
    await flushPromises()
    expect(api.searchUsers).toHaveBeenCalledWith('박민')
    const hits = qa('[data-testid="se-perf-hit"]')
    expect(hits.map((h) => h.text())).toEqual([expect.stringContaining('공정 CVD'), expect.stringContaining('공정 ETCH')])
    expect(hits[0].attributes('disabled')).toBeDefined()
    expect(hits[0].text()).toContain(t('SEW_PERF_SEARCH_ADDED'))
    await hits[1].trigger('click')
    expect(id('se-perf-pop').exists()).toBe(false)
    expect(qa('[data-testid="se-perf-dev"]').length).toBe(3)
    expect(pf('devp:2').element.value).toBe('')
    expect(document.activeElement).toBe(pf('devp:2').element)
    expect(errAt('devp:2').text()).toBe(t('RULE_DEV_CONTRIBUTION_RANGE'))
    await pf('devp:2').setValue('10')
    expect(errAt('devs').text()).toBe(t('RULE_DEV_TOTAL', { total: 110 }))
    expect(id('se-perf-sum').text()).toContain('110%')
    expect(saveBtn().attributes('disabled')).toBeDefined()
  })

  it('찾기 결과가 없으면 등록 사용자만 넣을 수 있다고 알리고, Esc 는 찾기 목록만 닫는다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setup()
    await flushPromises()
    api.searchUsers.mockReturnValue(ok([]))
    await pf('search').setValue('홍길동')
    vi.advanceTimersByTime(400)
    await flushPromises()
    expect(id('se-perf-pop').text()).toContain(t('SEW_PERF_SEARCH_NONE', { q: '홍길동' }))
    await pf('search').trigger('keydown', { key: 'Escape' })
    expect(id('se-perf-pop').exists()).toBe(false)
    expect(dlg()).not.toBeNull()
    expect(id('se-perf-leave').exists()).toBe(false)
  })

  it('옛 데이터의 같은 사람 두 줄: 고치지 않으면 경고와 [위 줄과 합치기], 고치면 DEV_DUPLICATE — 합치면 기여도를 더한다', async () => {
    setup({ performance: { ...PERF, citizenDevelopers: [{ knoxId: 'minsu.park', sdwt: '', name: '박민수', contribution: 50 }, { knoxId: 'minsu.park', sdwt: '', name: '박민수', contribution: 30 }, { knoxId: 'seoyeon.lee', sdwt: '', name: '이서연', contribution: 20 }] } })
    await flushPromises()
    expect(dlgText()).toContain(t('SEW_PERF_DEV_WARN_DUP'))
    expect(errAt('dev:1').exists()).toBe(false)
    expect(pf('merge:0').exists()).toBe(false)
    await pf('devp:2').setValue('10')
    expect(errAt('dev:1').text()).toBe(t('RULE_DEV_DUPLICATE'))
    await pf('merge:1').trigger('click')
    expect(qa('[data-testid="se-perf-dev"]').length).toBe(2)
    expect(pf('devp:0').element.value).toBe('80')
    expect(errAt('dev:1').exists()).toBe(false)
    expect(saveBtn().attributes('disabled')).toBeUndefined()
  })

  it('바꾼 채 닫으면(✕·[닫기]·Esc·바깥) 버릴지 묻고, 버리고 닫아도 서버에 아무것도 가지 않는다 — 묻는 창의 Esc 는 묻는 창만 닫는다', async () => {
    setup()
    await flushPromises()
    await pf('devdel:1').trigger('click') // 원개발자 빼기도 작업본에서만
    await pf('grade:1').trigger('click')
    await id('se-perf-close').trigger('click')
    expect(id('se-perf-leave').exists()).toBe(true)
    expect(id('se-perf-leave').text()).toContain('바꾼 2곳(등급, 원개발자)')
    expect(document.activeElement).toBe(id('se-perf-leave-keep').element)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(id('se-perf-leave').exists()).toBe(false)
    expect(dlg()).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(id('se-perf-leave').exists()).toBe(true)
    await id('se-perf-leave-drop').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[false]])
    expect(api.savePerformance).not.toHaveBeenCalled()
    expect(api.saveReview).not.toHaveBeenCalled()
  })

  it('바뀐 것이 없으면 바로 닫는다', async () => {
    setup()
    await flushPromises()
    await id('se-perf-close').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[false]])
  })

  it('[성과 저장]: 바꾼 칸만 보내고(원개발자를 안 고쳤으면 싣지 않음) 창은 남아 서버가 돌려준 값으로 다시 그린다 — 운영 속성 창 값도 바뀐다', async () => {
    const f = setup()
    await flushPromises()
    await pf('grade:1').trigger('click')
    await pf('comment').setValue('전 공정에 같은 알람이 있어 S 로 올림')
    await pf('effon:WaferLoss').setValue(true)
    await pf('effv:WaferLoss').setValue('25')
    const back = { ...PERF, grade: 1, gradeName: 'S', supervisor: 'choi_conductor', supervisorComment: '전 공정에 같은 알람이 있어 S 로 올림', waferLoss: 25, updateDate: '2026-11-09' }
    api.savePerformance.mockReturnValue(ok({ performance: back, applied: [] }))
    expect(footText()).toContain(t('SEW_PERF_CHANGED_N', { n: 3 }))
    await saveBtn().trigger('click')
    await flushPromises()
    expect(api.savePerformance).toHaveBeenCalledWith('P', 'M', 'N', {
      fields: { Grade: 1, SupervisorComment: '전 공정에 같은 알람이 있어 S 로 올림', WaferLoss: 25 }, alsoModels: []
    })
    expect(dlg()).not.toBeNull()
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(f.s.skeleton.performance).toEqual(back)
    expect(dlgText()).toContain('choi_conductor')
    expect(pf('effv:WaferLoss').element.value).toBe('25')
    expect(footText()).toContain(t('SEW_PERF_FOOT_SAVED_LINE'))
    expect(saveBtn().attributes('disabled')).toBeDefined()
    expect(f.e.toast.text).toBe(t('SEW_PERF_SAVED'))
  })

  it('원개발자를 고쳐 저장하면 다른 성과 칸과 한 요청으로 보낸다(KnoxId·Contribution)', async () => {
    setup()
    await flushPromises()
    await pf('devp:0').setValue('70')
    await pf('devp:1').setValue('30')
    api.savePerformance.mockReturnValue(ok({ performance: { ...PERF, citizenDevelopers: [{ knoxId: 'minsu.park', sdwt: '', name: '박민수', contribution: 70 }, { knoxId: 'seoyeon.lee', sdwt: '', name: '이서연', contribution: 30 }] }, applied: [] }))
    await saveBtn().trigger('click')
    await flushPromises()
    expect(api.savePerformance.mock.calls[0][3]).toEqual({
      fields: {}, citizenDevelopers: [{ KnoxId: 'minsu.park', Contribution: 70 }, { KnoxId: 'seoyeon.lee', Contribution: 30 }], alsoModels: []
    })
    expect(pf('devp:0').element.value).toBe('70')
  })

  it('같은 이름 일괄 적용: 고른 모델과 함께 쓸 칸을 보이고, 저장 뒤 모델별 결과 행·체크 모두 풂(다시 쓰기 버튼 없음)', async () => {
    const f = setup()
    await flushPromises()
    await pf('also:MODEL_B').setValue(true)
    expect(dlgText()).toContain(t('SEW_PERF_SAME_NOTHING'))
    await pf('grade:1').trigger('click')
    await pf('also:MODEL_C').setValue(true)
    expect(id('se-perf-same-note').text()).toContain('등급')
    api.savePerformance.mockReturnValue(ok({ performance: { ...PERF, grade: 1, gradeName: 'S' }, applied: [{ model: 'MODEL_B', ok: true }, { model: 'MODEL_C', ok: false, code: 'DATA_INVALID' }] }))
    await saveBtn().trigger('click')
    await flushPromises()
    expect(api.savePerformance.mock.calls[0][3]).toEqual({ fields: { Grade: 1 }, alsoModels: ['MODEL_B', 'MODEL_C'] })
    const rows = qa('[data-testid="se-perf-result"]')
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining(t('SEW_PERF_RESULT_OK')),
      expect.stringContaining(t('SEW_PERF_RESULT_DATA_INVALID'))
    ])
    expect(rows[0].text()).toContain('MODEL_B')
    expect(rows[1].text()).toContain('MODEL_C')
    expect(pf('also:MODEL_B').element.checked).toBe(false)
    expect(pf('also:MODEL_C').element.checked).toBe(false)
    expect(id('se-perf-results').findAll('button').length).toBe(0)
    expect(f.e.toast.text).toBe(t('SEW_PERF_SAVED_SOME', { n: 2, ok: 1, failed: 1 }))
  })

  it('서버가 막으면(422 VALIDATION_FAILED) 작업본을 두고 막힌 칸을 보인다', async () => {
    setup()
    await flushPromises()
    await pf('desc').setValue('설명을 고침')
    api.savePerformance.mockReturnValue(fail(422, 'VALIDATION_FAILED', { blocks: [{ code: 'EFFECT_VALUE', params: { field: 'ManWorkLoss' } }] }))
    await saveBtn().trigger('click')
    await flushPromises()
    expect(errAt('eff:ManWorkLoss').text()).toBe(t('RULE_EFFECT_VALUE'))
    expect(footText()).toContain(t('SEW_PERF_SAVE_BLOCKED'))
    expect(pf('desc').element.value).toBe('설명을 고침')
  })

  it('저장이 실패하면 이유를 알리고 작업본을 그대로 둔다', async () => {
    setup()
    await flushPromises()
    await pf('desc').setValue('설명을 고침')
    api.savePerformance.mockReturnValue(fail(404, 'NOT_FOUND'))
    await saveBtn().trigger('click')
    await flushPromises()
    expect(footText()).toContain(t('SEW_PERF_SAVE_FAILED', { cause: MESSAGES.SEW_ERR_NOT_FOUND }))
    expect(pf('desc').element.value).toBe('설명을 고침')
    expect(saveBtn().attributes('disabled')).toBeUndefined()
  })
})

describe('운영 속성 창과의 연결', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((fn) => fn.mockReset())
  })
  afterEach(() => { if (w) w.unmount(); w = null })

  it('WRITE 가 없어도 관리 등급 2 면 운영 속성 창(보기) [성과 입력]으로 열고, 닫으면 초점이 [성과 입력]으로 — 완료 칩·저장 뒤 값이 따라간다', async () => {
    const f = panelFixture([noneStep(0)], { canWrite: false, me: { singleid: 'choi_conductor', authorityManager: 2 } })
    f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: HEADER, property: { IsEnabled: true, Type: 1, Priority: 5, Owners: [], NextScenarioIfSuccess: null, NextScenarioIfFail: null }, performance: EMPTY }
    api.list.mockReturnValue(ok([]))
    api.sameName.mockReturnValue(ok(['M']))
    api.registeredUsers.mockReturnValue(ok([]))
    w = mount(ScenarioBar, { attachTo: document.body, global: { stubs: { teleport: false } } })
    await w.find('[data-testid="se-property"]').trigger('click')
    await flushPromises()
    expect(id('se-prop-edit').exists()).toBe(false) // 보기 모드
    expect(id('se-prop-perf-done').text()).toBe(t('SEW_PROP_PERF_INCOMPLETE'))
    await id('se-prop-perf-open').trigger('click')
    await flushPromises()
    expect(dlg()).not.toBeNull()
    await pf('grade:6').trigger('click')
    await pf('comment').setValue('삭제 대상으로 정함')
    await pf('trigger').setValue('5') // 트리거는 NotUsed 여도 필수
    expect(id('se-perf-done').text()).toBe('완료')
    api.savePerformance.mockReturnValue(ok({ performance: { ...EMPTY, grade: 6, gradeName: 'NotUsed', trigger: 5, triggerName: 'Scenario', supervisor: 'choi_conductor', supervisorNotEntered: false, supervisorComment: '삭제 대상으로 정함' }, applied: [] }))
    await saveBtn().trigger('click')
    await flushPromises()
    expect(api.savePerformance.mock.calls[0][3]).toEqual({ fields: { PerformType: 1, Grade: 6, SupervisorComment: '삭제 대상으로 정함', Trigger: 5 }, alsoModels: [] })
    await id('se-perf-close').trigger('click')
    await flushPromises()
    expect(dlg()).toBeNull()
    expect(document.activeElement).toBe(id('se-prop-perf-open').element)
    expect(id('se-prop-perf-done').text()).toBe(t('SEW_PROP_PERF_COMPLETE'))
    expect(id('se-prop-supervisor').text()).toContain('choi_conductor')
  })

  it('관리 등급 3(Manager)이면 [성과 입력] 대신 안내 — 칩은 보인다', async () => {
    const f = panelFixture([noneStep(0)], { me: { singleid: 'han_manager', authorityManager: 3 } })
    f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: HEADER, property: { IsEnabled: true, Type: 1, Priority: 5, Owners: [] }, performance: PERF }
    api.list.mockReturnValue(ok([]))
    w = mount(ScenarioBar, { attachTo: document.body, global: { stubs: { teleport: false } } })
    await w.find('[data-testid="se-property"]').trigger('click')
    await flushPromises()
    expect(id('se-prop-perf-open').exists()).toBe(false)
    expect(id('se-prop-perf-lock').text()).toBe(t('SEW_PROP_PERF_LOCK'))
    expect(id('se-prop-perf-done').text()).toBe(t('SEW_PROP_PERF_COMPLETE'))
  })
})
