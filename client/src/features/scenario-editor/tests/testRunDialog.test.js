// 시험 실행 창과 버튼(P5 설계 §4) — 고르기 줄(글자로 찾는 선택 상자 셋), 설비 표, 실행 조건, 확인, 결과
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ list: vi.fn(), testRunEquipment: vi.fn(), testRunScenario: vi.fn(), testRunRequest: vi.fn(), testRunStatus: vi.fn(), testRunRecipients: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import TestRunDialog from '../components/testrun/TestRunDialog.vue'
import SearchSelect from '../components/snapshot/SearchSelect.vue'
import { useTestRunStore } from '../stores/testRunStore'
import { useEditorStore } from '../stores/editorStore'
import { t } from '../messages'

enableAutoUnmount(afterEach)
const ok = (data) => Promise.resolve({ data: { data } })
const eqp = (eqpId, onoff = 'on', ipAddr = '10.99.1.1') => ({ eqpId, line: 'L1', ipAddr, ipAddrL: '', onoff })
const EQP = [eqp('A01'), eqp('A02', 'on', '10.99.2.7'), eqp('OFF', 'off'), eqp('BAD', 'unreadable')]
const ROWS = [{ name: 'RUN_A', isEnabled: true, status: [] }, { name: 'RUN_OFF', isEnabled: false, status: [] }, { name: 'RUN_DUP', isEnabled: true, status: ['DUPLICATE_PROPERTY'] }, { name: 'CHECK_X', isEnabled: true, status: ['NO_CURRENT_VERSION'] }]
const INFO = { current: { crtime: 1763427600000, stepCount: 6 }, isEnabled: true, startDelay: 30, retryCnt: 2, retryInterval: 10, priority: 5, next: { success: 'NEXT_OK', fail: null }, emailSkip: { success: true, stop: false, fail: false }, blocks: [], recent: [] }
const SCOPES = { processes: [{ process: 'P1', models: [{ model: 'M1', eqpCount: 4 }, { model: 'M2', eqpCount: 1 }] }, { process: 'P2', models: [{ model: 'M9', eqpCount: 1 }] }] }
const q = (sel) => document.body.querySelector(`[data-testid="${sel}"]`)
const qa = (sel) => [...document.body.querySelectorAll(`[data-testid="${sel}"]`)]
const fire = async (el, type, init = {}) => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })); await flushPromises() }
const type = async (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises() }

let store
let editor
async function open({ me = { singleid: 'u', testRun: { enabled: true, reason: null } } } = {}) {
  setActivePinia(createPinia())
  editor = useEditorStore()
  editor.me = me
  editor.scopes = SCOPES
  store = useTestRunStore()
  const w = mount(TestRunDialog, { attachTo: document.body })
  store.show()
  await flushPromises()
  return w
}
async function chosen() {
  const w = await open()
  store.setProcess('P1'); store.setModel('M1'); store.setName('RUN_A')
  await flushPromises()
  return w
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  Object.values(api).forEach((f) => f.mockReset())
  api.list.mockImplementation(() => ok(ROWS))
  api.testRunEquipment.mockImplementation(() => ok({ equipment: EQP, limits: { maxEquipment: 200, recentMin: 10 } }))
  api.testRunScenario.mockImplementation((p, m, name) => ok({ ...INFO, process: p, model: m, name }))
  api.testRunRequest.mockImplementation(() => ok({ outcome: 'accepted' }))
  api.testRunStatus.mockImplementation(() => ok({ now: Date.now(), items: [] }))
  api.testRunRecipients.mockImplementation(() => ok({ groups: [] }))
})

describe('SearchSelect — "전체" 줄을 끄는 속성', () => {
  it('noAll 이면 맨 위에 빈 줄이 없다(기본은 있다)', async () => {
    const w = mount(SearchSelect, { props: { modelValue: '', options: ['A', 'B'], allLabel: '고르세요', testid: 'x', noAll: true }, attachTo: document.body })
    await w.find('[data-testid="x"]').trigger('focus')
    expect(w.findAll('[data-testid="x-option"]').map((o) => o.attributes('data-value'))).toEqual(['A', 'B'])
    const all = mount(SearchSelect, { props: { modelValue: '', options: ['A', 'B'], allLabel: '전체', testid: 'y' }, attachTo: document.body })
    await all.find('[data-testid="y"]').trigger('focus')
    expect(all.findAll('[data-testid="y-option"]').map((o) => o.attributes('data-value'))).toEqual(['', 'A', 'B'])
  })
})

describe('고르기', () => {
  it('열면 창이 뜨고 공정·모델·시나리오 칸이 있다 — 고르기 전에는 설비 자리에 안내', async () => {
    await open()
    expect(q('se-run')).not.toBeNull()
    for (const id of ['se-run-process', 'se-run-model', 'se-run-scenario']) expect(q(id)).not.toBeNull()
    expect(q('se-run-model').disabled).toBe(true)
    expect(q('se-run-scenario').disabled).toBe(true)
    expect(q('se-run-empty').textContent).toBe(t('SEW_RUN_EQP_PICK_FIRST'))
    expect(q('se-run-go').disabled).toBe(true)
    expect(q('se-run-summary').textContent).toContain(t('SEW_RUN_WHY_NO_SCENARIO'))
  })
  it('공정 칸에 글자를 치면 항목이 좁혀지고 Enter 로 고른다 — 모델 칸이 켜진다', async () => {
    await open()
    const input = q('se-run-process')
    input.dispatchEvent(new Event('focus'))
    await type(input, 'p2')
    expect(qa('se-run-process-option').map((o) => o.dataset.value)).toEqual(['P2'])
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(store.sel.process).toBe('P2')
    expect(q('se-run-model').disabled).toBe(false)
  })
  it('시나리오 항목 옆에 꺼짐·확인 필요·현재 판 없음 표시가 붙는다', async () => {
    await open()
    store.setProcess('P1'); store.setModel('M1')
    await flushPromises()
    q('se-run-scenario').dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(qa('se-run-scenario-option').map((o) => o.dataset.value)).toEqual(['RUN_A', 'RUN_OFF', 'RUN_DUP', 'CHECK_X'])
    expect(qa('se-run-scenario-note').map((n) => n.textContent)).toEqual([t('SEW_RUN_MARK_off'), t('SEW_RUN_MARK_check'), t('SEW_RUN_MARK_noVersion')])
  })
  it('시나리오를 고르면 공정-모델-이름·현재 판·스텝 수와 "배포된 현재 판이 돕니다", 운영 속성이 보인다', async () => {
    await chosen()
    expect(q('se-run-target').textContent).toContain('P1-M1-RUN_A')
    expect(q('se-run-target').textContent).toContain('6')
    expect(q('se-run-note').textContent).toBe(t('SEW_RUN_NOTE_CURRENT'))
    const props = q('se-run-props').textContent
    for (const s of [t('SEW_RUN_PROP_DELAY_VALUE', { n: 30 }), t('SEW_RUN_PROP_RETRY_VALUE', { n: 2, sec: 10 }), t('SEW_RUN_PROP_NEXT_SUCCESS', { name: 'NEXT_OK' }), t('SEW_RUN_PROP_DELAY_HINT', { n: 30 })]) expect(props).toContain(s)
    expect(q('se-run-step-range').textContent).toBe(t('SEW_RUN_STEP_RANGE_HINT', { max: 6 }))
  })
  it('실행할 수 없는 시나리오를 고르면 까닭이 위에 붉게 보이고 [실행] 이 꺼진다', async () => {
    api.testRunScenario.mockImplementation(() => ok({ ...INFO, isEnabled: false, blocks: ['TEST_RUN_SCENARIO_OFF'] }))
    await chosen()
    expect(q('se-run-block').textContent).toBe(t('SEW_ERR_TEST_RUN_SCENARIO_OFF'))
    expect(q('se-run-note')).toBeNull()
    expect(q('se-run-go').disabled).toBe(true)
  })
  it('편집기에 옛 판으로 열어 둔 시나리오를 골랐으면 "현재 판이 돕니다" 안내, 시작 스텝이 1 이 아니면 번호 경고', async () => {
    const w = await open()
    editor.skeleton = { process: 'P1', model: 'M1', name: 'RUN_A', version: { crtime: 1000, isCurrent: false }, steps: [] }
    store.setProcess('P1'); store.setModel('M1'); store.setName('RUN_A')
    await flushPromises()
    expect(q('se-run-note').textContent).toBe(t('SEW_RUN_NOTE_OLD'))
    expect(q('se-run-step-warn')).toBeNull()
    await type(q('se-run-step'), '2')
    expect(q('se-run-step-warn').textContent).toBe(t('SEW_RUN_STEP_MISMATCH', { n: 2 }))
    // 현재 판 그대로 열어 둔 시나리오는 그 번호 스텝의 설명을 보인다
    editor.skeleton = { process: 'P1', model: 'M1', name: 'RUN_A', version: { crtime: INFO.current.crtime, isCurrent: true }, steps: [{ uid: 's0', descriptionToEmail: '알람 창 찾기', notes: [] }, { uid: 's1', descriptionToEmail: 'Reset 누르기', notes: [] }] }
    await flushPromises()
    expect(q('se-run-step-warn')).toBeNull()
    expect(q('se-run-step-desc').textContent).toBe(t('SEW_RUN_STEP_DESC', { n: 2, desc: 'Reset 누르기' }))
    expect(q('se-run-note').textContent).toBe(t('SEW_RUN_NOTE_CURRENT'))
    w.unmount()
  })
})

describe('설비 표', () => {
  it('설비 줄: OFF·읽을 수 없는 설비는 흐리고 고를 수 없다. 검색 칸으로 설비 ID·IP 를 찾는다', async () => {
    await chosen()
    expect(qa('se-run-row').map((r) => [r.dataset.id, r.dataset.off])).toEqual([['A01', 'false'], ['A02', 'false'], ['OFF', 'true'], ['BAD', 'true']])
    expect(qa('se-run-row')[2].textContent).toContain(t('SEW_RUN_OFF_HINT'))
    expect(qa('se-run-row')[2].querySelector('input').disabled).toBe(true)
    await type(q('se-run-search'), '2.7')
    expect(qa('se-run-row').map((r) => r.dataset.id)).toEqual(['A02'])
    await type(q('se-run-search'), 'zzz')
    expect(q('se-run-empty').textContent).toBe(t('SEW_RUN_EQP_NO_MATCH'))
  })
  it('줄 누르기·Ctrl·머리 칸으로 고르고 수를 보인다 — 가려진 선택도 센다', async () => {
    await chosen()
    await fire(qa('se-run-row')[0], 'click')
    expect(qa('se-run-row')[0].getAttribute('aria-selected')).toBe('true')
    await fire(qa('se-run-row')[1], 'click', { ctrlKey: true })
    expect([...store.picked].sort()).toEqual(['A01', 'A02'])
    await fire(qa('se-run-row')[2], 'click')
    expect([...store.picked].sort()).toEqual(['A01', 'A02']) // OFF 줄은 눌러도 그대로
    expect(q('se-run-count').textContent).toBe(t('SEW_RUN_EQP_COUNT', { n: 2, total: 4 }))
    await type(q('se-run-search'), 'A02')
    expect(q('se-run-count').textContent).toBe(t('SEW_RUN_EQP_COUNT_HIDDEN', { n: 2, hidden: 1, total: 4 }))
    await type(q('se-run-search'), '')
    // 머리 칸: 고를 수 있는 줄이 모두 골라져 있으면 모두 풀고, 다시 누르면 모두 고른다(OFF 줄은 빼고)
    expect(q('se-run-all').checked).toBe(true)
    q('se-run-all').click()
    await flushPromises()
    expect(store.picked.size).toBe(0)
    q('se-run-all').click()
    await flushPromises()
    expect([...store.picked].sort()).toEqual(['A01', 'A02'])
  })
})

describe('실행 조건과 확인', () => {
  it('기타 사유를 고르면 글 칸이 나오고 규칙에 안 맞으면 붉게, 시작 스텝이 범위 밖이면 [실행] 이 꺼지고 까닭이 보인다', async () => {
    await chosen()
    await fire(qa('se-run-row')[0], 'click')
    expect(q('se-run-go').disabled).toBe(false)
    q('se-run-reason-other').click()
    await flushPromises()
    expect(q('se-run-reason-error').textContent).toBe(t('SEW_RUN_REASON_EMPTY'))
    expect(q('se-run-go').disabled).toBe(true)
    await type(q('se-run-reason-text'), 'a<b')
    expect(q('se-run-reason-error').textContent).toBe(t('SEW_RUN_REASON_BAD_CHAR'))
    await type(q('se-run-reason-text'), '밸브 점검')
    expect(q('se-run-reason-error')).toBeNull()
    await type(q('se-run-step'), '7')
    expect(q('se-run-step-error').textContent).toBe(t('SEW_RUN_STEP_RANGE', { max: 6 }))
    expect(q('se-run-go').title).toBe(t('SEW_RUN_STEP_RANGE', { max: 6 }))
    await type(q('se-run-step'), '3')
    expect(q('se-run-go').disabled).toBe(false)
    expect(q('se-run-summary').textContent).toBe(t('SEW_RUN_READY', { name: 'RUN_A', n: 1, step: 3, reason: '밸브 점검' }))
  })
  it('[실행] → 확인 창(설비 수·시나리오·시작 스텝·사유, 처음 초점은 [취소]) → [취소] 는 고르기로', async () => {
    await chosen()
    await fire(qa('se-run-row')[0], 'click')
    q('se-run-go').click()
    await flushPromises()
    expect(q('se-run-confirm-title').textContent).toBe(t('SEW_RUN_CONFIRM_TITLE', { n: 1, name: 'RUN_A', step: 1 }))
    expect(q('se-run-confirm').textContent).toContain(t('SEW_RUN_CONFIRM_REAL'))
    expect(q('se-run-confirm').textContent).toContain(t('SEW_RUN_REASON_KIND_INSPECTION'))
    expect(document.activeElement).toBe(q('se-run-confirm-cancel'))
    expect(api.testRunRequest).not.toHaveBeenCalled()
    q('se-run-confirm-cancel').click()
    await flushPromises()
    expect(q('se-run-confirm')).toBeNull()
    expect(store.stage).toBe('pick')
  })
  it('방금 요청한 설비가 있으면 확인 창이 알리고 "다시 보낸다" 체크 칸을 둔다(처음 = 꺼짐)', async () => {
    api.testRunScenario.mockImplementation(() => ok({ ...INFO, recent: [{ eqpId: 'A01', by: 'kim', at: Date.now() - 180_000 }] }))
    await chosen()
    expect(qa('se-run-row')[0].textContent).toContain('kim')
    await fire(qa('se-run-row')[0], 'click')
    q('se-run-go').click()
    await flushPromises()
    expect(q('se-run-confirm-recent').textContent).toContain(t('SEW_RUN_CONFIRM_RECENT', { n: 1 }))
    expect(q('se-run-confirm-again').checked).toBe(false)
    q('se-run-confirm-again').click()
    await flushPromises()
    q('se-run-confirm-ok').click()
    await flushPromises()
    expect(api.testRunRequest.mock.calls[0][0].again).toBe(true)
  })
})

describe('결과 메일 수신인', () => {
  it('묶음마다 설비 수·묶음 이름·주소를 보이고, 메일이 가지 않는 묶음은 까닭을 붉게 — "실행이 끝날 때 다시 정해집니다"', async () => {
    api.testRunRecipients.mockImplementation(() => ok({ groups: [
      { category: 'SEW-NIGHT', source: 'rule', eqpIds: ['A01'], accounts: ['night@x.com', 'lead@x.com'], problem: null },
      { category: 'SEW-GONE', source: 'equipment', eqpIds: ['A02'], accounts: [], problem: 'INFO_MISSING' }
    ] }))
    await chosen()
    expect(q('se-run-mail').textContent).toContain(t('SEW_RUN_MAIL_EMPTY'))
    await fire(qa('se-run-row')[0], 'click')
    await fire(qa('se-run-row')[1], 'click', { ctrlKey: true })
    await new Promise((r) => setTimeout(r, 350))
    await flushPromises()
    const groups = qa('se-run-mail-group')
    expect(groups).toHaveLength(2)
    expect(groups[0].textContent).toContain(t('SEW_RUN_MAIL_GROUP', { n: 1, category: 'SEW-NIGHT' }))
    expect(groups[0].textContent).toContain('night@x.com · lead@x.com')
    expect(groups[1].textContent).toContain(t('SEW_RUN_MAIL_PROBLEM_INFO_MISSING'))
    expect(q('se-run-mail').textContent).toContain(t('SEW_RUN_MAIL_NOTE'))
    // 이 시나리오는 성공일 때 메일을 생략한다(INFO 의 emailSkip.success)
    expect(q('se-run-mail').textContent).toContain(t('SEW_RUN_MAIL_SKIP', { list: t('SEW_RUN_PROP_SKIP_success') }))
  })
})

describe('결과', () => {
  async function ran(answers) {
    for (const a of answers) api.testRunRequest.mockImplementationOnce(() => ok(a))
    await chosen()
    await fire(qa('se-run-row')[0], 'click')
    await fire(qa('se-run-row')[1], 'click', { ctrlKey: true })
    q('se-run-go').click()
    await flushPromises()
    q('se-run-confirm-ok').click()
    await flushPromises()
  }
  it('설비마다 요청 결과와 까닭, 요약 한 줄, [다시 고르기]', async () => {
    await ran([{ outcome: 'accepted' }, { outcome: 'failed', detail: 'invalid http headers' }])
    expect(qa('se-run-result-row').map((r) => r.dataset.id)).toEqual(['A01', 'A02'])
    expect(qa('se-run-outcome').map((o) => o.textContent.trim())).toEqual([t('SEW_RUN_OUTCOME_accepted'), t('SEW_RUN_OUTCOME_failed')])
    expect(qa('se-run-result-row')[1].textContent).toContain('invalid http headers')
    expect(q('se-run-result-summary').textContent).toBe(t('SEW_RUN_SUMMARY', { accepted: 1, notSent: 0, failed: 1, unknown: 0 }))
    expect(q('se-run-progress').textContent).toBe(t('SEW_RUN_PROGRESS_DONE', { done: 2, total: 2 }))
    expect(q('se-run-stop')).toBeNull()
    q('se-run-again').click()
    await flushPromises()
    expect(store.stage).toBe('pick')
    expect([...store.picked]).toEqual(['A02'])
  })
  it('실행 상태 열: 찾은 기록의 상태 글과 등록 시각, 조회가 실패하면 알리고 [상태 새로 고침]', async () => {
    api.testRunStatus.mockImplementationOnce(() => ok({ now: 5000, items: [
      { eqpId: 'A01', outcome: 'accepted', detail: null, sentAt: 4000, found: 1, status: 'StartScenario', retry: '0/2/10', txnSeq: 4100, createDate: '2026-11-18T10:20:30.123+09:00' },
      { eqpId: 'A02', outcome: 'accepted', detail: null, sentAt: 4000, found: 2, status: 'Success', retry: '0/2/10', txnSeq: 4200, createDate: '2026-11-18T10:20:31.000+09:00' }
    ] }))
    await ran([{ outcome: 'accepted' }, { outcome: 'accepted' }])
    await new Promise((r) => setTimeout(r, 20))
    await flushPromises()
    expect(qa('se-run-state').map((s) => s.textContent.trim())).toEqual([t('SEW_RUN_STATE_RUNNING'), `${t('SEW_RUN_STATE_SUCCESS')} · ${t('SEW_RUN_CANDIDATES', { n: 2 })}`])
    expect(qa('se-run-result-row')[0].textContent).toContain('10:20:30')
    api.testRunStatus.mockImplementationOnce(() => Promise.reject({ response: { status: 503, data: { code: 'TEST_RUN_STATUS_FAILED' } } }))
    q('se-run-status-refresh').click()
    await flushPromises()
    expect(q('se-run-status-failed').textContent).toBe(t('SEW_RUN_STATUS_FAILED'))
  })
  it('멈춘 까닭(연달아 모름)을 위에 보이고 남은 설비는 "보내지 않음"', async () => {
    api.testRunRequest.mockImplementation(() => ok({ outcome: 'unknown' }))
    api.testRunEquipment.mockImplementation(() => ok({ equipment: [eqp('A01'), eqp('A02'), eqp('A03'), eqp('A04')], limits: { maxEquipment: 200, recentMin: 10 } }))
    await chosen()
    q('se-run-all').click()
    await flushPromises()
    q('se-run-go').click(); await flushPromises()
    q('se-run-confirm-ok').click(); await flushPromises()
    expect(q('se-run-halt').textContent).toBe(t('SEW_RUN_HALT_STREAK'))
    expect(qa('se-run-outcome').map((o) => o.textContent.trim())).toEqual([...Array(3).fill(t('SEW_RUN_OUTCOME_unknown')), t('SEW_RUN_OUTCOME_skipped')])
    expect(q('se-run-progress').textContent).toBe(t('SEW_RUN_PROGRESS_STOPPED', { done: 3, total: 4 })) // 보내지 않은 설비는 세지 않는다
  })
  it('보내는 중에 닫으려 하면 묻는다 — [계속 보내기] 는 그대로, [닫기] 는 남은 설비를 보내지 않는다', async () => {
    let release
    api.testRunRequest.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: { data: { outcome: 'accepted' } } }) }))
    await chosen()
    await fire(qa('se-run-row')[0], 'click')
    await fire(qa('se-run-row')[1], 'click', { ctrlKey: true })
    q('se-run-go').click(); await flushPromises()
    q('se-run-confirm-ok').click(); await flushPromises()
    expect(q('se-run-stop')).not.toBeNull()
    q('se-run-close').click(); await flushPromises()
    expect(q('se-run-close-confirm').textContent).toContain(t('SEW_RUN_CLOSE_CONFIRM', { n: 2 }))
    q('se-run-keep').click(); await flushPromises()
    expect(store.open).toBe(true)
    q('se-run-close').click(); await flushPromises()
    q('se-run-close-anyway').click(); await flushPromises()
    expect(store.open).toBe(false)
    release(); await flushPromises()
    expect(api.testRunRequest).toHaveBeenCalledTimes(1)
  })
})
