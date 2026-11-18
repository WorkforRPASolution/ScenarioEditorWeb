// 시험 실행 저장소(P5 설계 §4.10) — 고르기와 비우기, 늦은 응답 버리기, 차례로 보내기(429·멈춤·중지·요청 전체 오류·응답 없음), 실행 상태 다시 읽기, 다시 고르기
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ list: vi.fn(), testRunEquipment: vi.fn(), testRunScenario: vi.fn(), testRunRequest: vi.fn(), testRunStatus: vi.fn(), testRunRecipients: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import { useTestRunStore } from '../stores/testRunStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'

const ok = (data) => Promise.resolve({ data: { data } })
const fail = (status, code, details) => Promise.reject({ response: { status, data: { code, details } } })
const defer = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const eqp = (eqpId, onoff = 'on', agent = 'on') => ({ eqpId, line: 'L1', ipAddr: '10.99.1.1', ipAddrL: '', onoff, agent })
const EQP = [eqp('A01'), eqp('A02'), eqp('A03'), eqp('A04'), eqp('OFF', 'off')]
const ROWS = [{ name: 'RUN_A', isEnabled: true, status: [] }, { name: 'RUN_OFF', isEnabled: false, status: [] }]
const INFO = { process: 'P1', model: 'M1', name: 'RUN_A', current: { crtime: 2000, stepCount: 6 }, isEnabled: true, startDelay: 0, retryCnt: 0, retryInterval: 10, priority: 10, next: { success: null, fail: null }, emailSkip: { success: false, stop: false, fail: false }, blocks: [], recent: [] }
const SCOPES = { processes: [{ process: 'P1', models: [{ model: 'M1', eqpCount: 5 }, { model: 'M2', eqpCount: 1 }] }, { process: 'P2', models: [{ model: 'M9', eqpCount: 1 }] }] }
const statusOf = (items, now = 5000) => ok({ now, items })

let store
let editor
function setup({ scopes = SCOPES, me = { singleid: 'u', testRun: { enabled: true, reason: null } } } = {}) {
  setActivePinia(createPinia())
  editor = useEditorStore()
  editor.me = me
  editor.scopes = scopes
  store = useTestRunStore()
}
async function ready() {
  store.show()
  store.setProcess('P1')
  store.setModel('M1')
  store.setName('RUN_A')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  Object.values(api).forEach((f) => f.mockReset())
  api.list.mockImplementation(() => ok(ROWS))
  api.testRunEquipment.mockImplementation(() => ok({ equipment: EQP, limits: { maxEquipment: 200, recentMin: 10 } }))
  api.testRunScenario.mockImplementation((p, m, name) => ok({ ...INFO, process: p, model: m, name }))
  api.testRunRequest.mockImplementation(() => ok({ outcome: 'accepted' }))
  api.testRunStatus.mockImplementation(() => statusOf([]))
  api.testRunRecipients.mockImplementation(() => ok({ groups: [] }))
  setup()
})
afterEach(() => { vi.useRealTimers() })

describe('열기와 처음 값', () => {
  it('편집기에 연 시나리오가 있으면 그 공정·모델·시나리오가 미리 골라지고 목록·설비·정보를 읽는다', async () => {
    editor.skeleton = { process: 'P1', model: 'M1', name: 'RUN_A', version: { crtime: 2000, isCurrent: true }, steps: [] }
    store.show()
    await flushPromises()
    expect(store.open).toBe(true)
    expect(store.sel).toEqual({ process: 'P1', model: 'M1', name: 'RUN_A' })
    expect(api.list).toHaveBeenCalledWith('P1', 'M1')
    expect(api.testRunEquipment).toHaveBeenCalledWith('P1', 'M1')
    expect(api.testRunScenario).toHaveBeenCalledWith('P1', 'M1', 'RUN_A')
    expect(store.info.data.current.stepCount).toBe(6)
  })
  it('연 시나리오가 없으면 마지막에 쓴 공정·모델(브라우저에 기억) — 내 범위에 없는 값은 버린다', async () => {
    localStorage.setItem('se-test-run', JSON.stringify({ process: 'P1', model: 'M2' }))
    store.show()
    await flushPromises()
    expect(store.sel).toEqual({ process: 'P1', model: 'M2', name: '' })
    expect(api.testRunEquipment).toHaveBeenCalledWith('P1', 'M2')
    setup()
    localStorage.setItem('se-test-run', JSON.stringify({ process: 'GONE', model: 'M2' }))
    store.show()
    expect(store.sel).toEqual({ process: '', model: '', name: '' })
  })
  it('기억도 없고 내 공정이 하나뿐이면 그 공정', () => {
    setup({ scopes: { processes: [SCOPES.processes[1]] } })
    store.show()
    expect(store.sel).toEqual({ process: 'P2', model: '', name: '' })
  })
  it('이미 고른 것이 있으면 다시 열어도 바꾸지 않는다(편집기에서 다른 시나리오를 열어도)', async () => {
    await ready()
    store.hide()
    editor.skeleton = { process: 'P2', model: 'M9', name: 'OTHER', version: { crtime: 1, isCurrent: true }, steps: [] }
    store.show()
    expect(store.sel).toEqual({ process: 'P1', model: 'M1', name: 'RUN_A' })
  })
  it('공정·모델 항목은 내 범위에서', () => {
    store.show()
    expect(store.processes).toEqual(['P1', 'P2'])
    store.setProcess('P1')
    expect(store.models).toEqual(['M1', 'M2'])
  })
})

describe('고르기와 비우기', () => {
  it('공정을 바꾸면 모델·시나리오·설비 선택이, 모델을 바꾸면 시나리오·설비 선택이 비워진다. 시나리오만 바꾸면 설비 선택은 남는다', async () => {
    await ready()
    store.click('A01', {})
    store.setName('RUN_OFF')
    expect([...store.picked]).toEqual(['A01'])
    store.setModel('M2')
    expect([store.sel, [...store.picked]]).toEqual([{ process: 'P1', model: 'M2', name: '' }, []])
    store.setModel('M1'); store.setName('RUN_A'); store.click('A02', {})
    store.setProcess('P2')
    expect([store.sel, [...store.picked], store.targets.items, store.scenarios.rows]).toEqual([{ process: 'P2', model: '', name: '' }, [], [], []])
  })
  it('마지막 공정·모델을 브라우저에 기억한다', async () => {
    await ready()
    expect(JSON.parse(localStorage.getItem('se-test-run'))).toEqual({ process: 'P1', model: 'M1' })
  })
  it('늦게 온 목록·설비·정보는 버린다 — 모델을 바꾼 뒤 앞 모델의 답이 와도 붙지 않는다(DC-010)', async () => {
    const slowList = defer(); const slowEqp = defer(); const slowInfo = defer()
    api.list.mockImplementationOnce(() => slowList.promise)
    api.testRunEquipment.mockImplementationOnce(() => slowEqp.promise)
    api.testRunScenario.mockImplementationOnce(() => slowInfo.promise)
    store.show(); store.setProcess('P1'); store.setModel('M1'); store.setName('RUN_A')
    store.setModel('M2')
    await flushPromises()
    slowList.resolve({ data: { data: [{ name: 'FROM_M1', isEnabled: true, status: [] }] } })
    slowEqp.resolve({ data: { data: { equipment: [eqp('M1_ONLY')], limits: { maxEquipment: 200, recentMin: 10 } } } })
    slowInfo.resolve({ data: { data: { ...INFO, name: 'RUN_A' } } })
    await flushPromises()
    expect(store.scenarios.rows.map((r) => r.name)).toEqual(['RUN_A', 'RUN_OFF']) // M2 의 목록(가짜는 같은 값을 준다)
    expect(store.targets.items.map((e) => e.eqpId)).not.toContain('M1_ONLY')
    expect(store.info.data).toBeNull()
  })
  it('읽는 동안과 시나리오가 막혔을 때 [실행] 은 꺼진다', async () => {
    const slow = defer()
    api.testRunScenario.mockImplementationOnce(() => slow.promise)
    store.show(); store.setProcess('P1'); store.setModel('M1'); store.setName('RUN_A')
    await flushPromises()
    store.click('A01', {})
    expect(store.block).toEqual({ key: 'SEW_RUN_WHY_LOADING' })
    slow.resolve({ data: { data: { ...INFO, blocks: ['TEST_RUN_SCENARIO_OFF'] } } })
    await flushPromises()
    expect(store.block).toEqual({ key: 'SEW_ERR_TEST_RUN_SCENARIO_OFF' })
  })
  it('목록·설비·정보를 읽지 못하면 그 자리에 오류를 남긴다', async () => {
    api.testRunEquipment.mockImplementationOnce(() => fail(503, 'UPSTREAM_DOWN'))
    await ready()
    expect(store.targets.status).toBe('error')
    expect(store.targets.message).toBeTruthy()
    expect(store.scenarios.status).toBe('ready')
  })
  it('모델을 바꾸면 앞 모델의 설비 줄을 바로 비운다. 설비를 다시 읽지 못하면 선택도 비운다', async () => {
    await ready()
    store.click('A01', {})
    const slow = defer()
    api.testRunEquipment.mockImplementationOnce(() => slow.promise)
    store.setModel('M2')
    expect(store.targets.items).toEqual([]) // 읽는 동안 앞 모델의 줄이 남아 눌리지 않는다
    slow.resolve({ data: { data: { equipment: EQP, limits: { maxEquipment: 200, recentMin: 10 } } } })
    await flushPromises()
    store.click('A01', {})
    api.testRunEquipment.mockImplementationOnce(() => fail(503, 'UPSTREAM_DOWN'))
    store.reload()
    await flushPromises()
    expect([store.targets.status, store.targets.items, [...store.picked]]).toEqual(['error', [], []])
  })
  it('시나리오 정보를 읽지 못했으면 [실행] 의 까닭이 "읽는 중" 이 아니라 읽지 못했다는 것이다', async () => {
    api.testRunScenario.mockImplementationOnce(() => fail(503, 'UPSTREAM_DOWN'))
    await ready()
    store.click('A01', {})
    expect(store.block).toEqual({ key: 'SEW_RUN_WHY_INFO_FAILED' })
  })
  it('설비 고르기: 줄·더하기·범위·머리 칸 — OFF 설비는 골라지지 않고, 검색으로 가려진 선택은 남는다', async () => {
    await ready()
    store.click('A01', {})
    store.click('A03', { range: true })
    expect([...store.picked].sort()).toEqual(['A01', 'A02', 'A03'])
    store.click('OFF', { toggle: true })
    expect(store.picked.has('OFF')).toBe(false)
    store.query = 'A04'
    expect(store.shown.map((e) => e.eqpId)).toEqual(['A04'])
    store.toggleAllShown(true)
    expect([...store.picked].sort()).toEqual(['A01', 'A02', 'A03', 'A04'])
    expect(store.hidden).toBe(3)
  })
  it('[새로 고침] 은 설비와 시나리오 정보를 다시 읽고, 사라진 설비의 선택을 푼다', async () => {
    await ready()
    store.click('A01', {}); store.click('A02', { toggle: true })
    api.testRunEquipment.mockImplementationOnce(() => ok({ equipment: [eqp('A01'), eqp('A02', 'off')], limits: { maxEquipment: 200, recentMin: 10 } }))
    store.reload()
    await flushPromises()
    expect([...store.picked]).toEqual(['A01'])
    expect(api.testRunScenario).toHaveBeenCalledTimes(2)
  })
})

describe('편집기에 연 시나리오와의 관계', () => {
  it('같은 시나리오를 현재 판 그대로 열어 두었으면 스텝 설명을 준다. 고쳤거나 옛 판이면 관계만 알린다', async () => {
    editor.skeleton = { process: 'P1', model: 'M1', name: 'RUN_A', version: { crtime: 2000, isCurrent: true }, steps: [{ uid: 's0', descriptionToEmail: '알람 창 찾기', notes: [] }, { uid: 's1', descriptionToEmail: 'Reset 누르기', notes: [] }] }
    await ready()
    expect(store.relation).toBe('same')
    store.startStep = '2'
    expect(store.stepDesc).toBe('Reset 누르기')
    editor.skeleton = { ...editor.skeleton, version: { crtime: 1000, isCurrent: false } }
    expect(store.relation).toBe('old')
    expect(store.stepDesc).toBeNull()
    store.setName('RUN_OFF')
    expect(store.relation).toBe('none')
  })
  it('연 뒤에 다른 사람이 새 판을 배포했으면(현재 판의 crtime 이 다르다) 현재 판 그대로가 아니다 — 스텝 설명을 보이지 않는다', async () => {
    editor.skeleton = { process: 'P1', model: 'M1', name: 'RUN_A', version: { crtime: 1500, isCurrent: true }, steps: [{ uid: 's0', descriptionToEmail: '옛 1번', notes: [] }] }
    await ready()
    expect(store.info.data.current.crtime).toBe(2000)
    expect(store.relation).toBe('old')
    expect(store.stepDesc).toBeNull()
  })
  it('저장하지 않은 고침이 있으면 dirty', async () => {
    editor.skeleton = { process: 'P1', model: 'M1', name: 'RUN_A', version: { crtime: 2000, isCurrent: true }, steps: [] }
    const edit = useEditStore()
    await ready()
    vi.spyOn(edit, 'unsavedCount', 'get').mockReturnValue(2)
    expect(store.openedScenario()).toMatchObject({ unsaved: 2 })
  })
})

describe('실행', () => {
  async function picked(ids = ['A01', 'A02', 'A03']) {
    await ready()
    for (const id of ids) store.click(id, { toggle: true })
  }
  it('확인을 거쳐 설비 ID 순으로 한 번에 하나씩 보낸다 — 실행마다 같은 runId, 사유·시작 스텝·again 을 싣는다', async () => {
    await picked(['A03', 'A01'])
    store.reasonKind = 'other'; store.reasonText = ' 점검 '; store.startStep = '2'
    await store.ask()
    expect(store.stage).toBe('confirm')
    const gate = defer()
    api.testRunRequest.mockImplementationOnce(() => gate.promise)
    const done = store.start()
    await flushPromises()
    expect(store.stage).toBe('running')
    expect(api.testRunRequest).toHaveBeenCalledTimes(1)
    expect(store.run.items.map((x) => [x.eqpId, x.outcome])).toEqual([['A01', 'sending'], ['A03', 'waiting']])
    gate.resolve({ data: { data: { outcome: 'accepted' } } })
    await done
    expect(store.stage).toBe('done')
    const bodies = api.testRunRequest.mock.calls.map((c) => c[0])
    expect(bodies.map((b) => b.eqpId)).toEqual(['A01', 'A03'])
    expect(bodies[0]).toMatchObject({ process: 'P1', model: 'M1', name: 'RUN_A', startStep: 2, reason: { kind: 'other', text: '점검' }, again: false })
    expect(bodies[0].runId).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(bodies[1].runId).toBe(bodies[0].runId)
    expect(store.run.items.map((x) => x.outcome)).toEqual(['accepted', 'accepted'])
  })
  it('막혀 있으면 확인으로 넘어가지 않는다', async () => {
    await ready()
    await store.ask()
    expect(store.stage).toBe('pick')
  })
  it('확인 창의 "방금 요청한 설비에도 다시 보낸다" 를 켜면 again 으로 보낸다. 방금 요청한 설비를 알려 준다', async () => {
    api.testRunScenario.mockImplementation(() => ok({ ...INFO, recent: [{ eqpId: 'A02', by: 'kim', at: 4000 }, { eqpId: 'A04', by: 'lee', at: 4100 }] }))
    await picked(['A01', 'A02'])
    expect(store.recentPicked).toEqual([{ eqpId: 'A02', by: 'kim', at: 4000 }])
    await store.ask(); store.again = true
    await store.start()
    // 확인 창에 보인 설비(A02)에만 again 을 싣는다 — 보이지 않은 설비(A01)는 그 사이 누가 요청했어도 서버의 "방금 요청함" 이 막는다
    expect(api.testRunRequest.mock.calls.map((c) => [c[0].eqpId, c[0].again])).toEqual([['A01', false], ['A02', true]])
  })
  it('확인으로 넘어갈 때 시나리오 정보를 다시 읽는다 — 그 사이 다른 사람이 요청한 설비가 확인 창에 보이고, 그 사이 막혔으면 넘어가지 않는다', async () => {
    await picked(['A01', 'A02'])
    expect(store.recentPicked).toEqual([])
    api.testRunScenario.mockImplementation(() => ok({ ...INFO, recent: [{ eqpId: 'A01', by: 'lee', at: 4500 }] }))
    await store.ask()
    expect(store.stage).toBe('confirm')
    expect(store.recentPicked).toEqual([{ eqpId: 'A01', by: 'lee', at: 4500 }])
    store.cancel()
    api.testRunScenario.mockImplementation(() => ok({ ...INFO, isEnabled: false, blocks: ['TEST_RUN_SCENARIO_OFF'] }))
    await store.ask()
    expect(store.stage).toBe('pick')
    expect(store.block).toEqual({ key: 'SEW_ERR_TEST_RUN_SCENARIO_OFF' })
  })
  it('설비마다의 결과(보내지 않음·실패)는 그대로 적고 다음 설비로 간다', async () => {
    api.testRunRequest.mockImplementationOnce(() => ok({ outcome: 'off' })).mockImplementationOnce(() => ok({ outcome: 'failed', detail: '까닭' })).mockImplementationOnce(() => ok({ outcome: 'recent', detail: { by: 'kim', at: 1 } }))
    await picked()
    await store.ask(); await store.start()
    expect(store.run.items.map((x) => [x.outcome, x.detail ?? null])).toEqual([['off', null], ['failed', '까닭'], ['recent', { by: 'kim', at: 1 }]])
    expect(store.run.halt).toBeNull()
  })
  it('응답을 받지 못한 설비(시간 초과·끊김)는 접수 여부 모름 + lost 로 두고 다시 보내지 않는다', async () => {
    api.testRunRequest.mockImplementationOnce(() => Promise.reject({ code: 'ECONNABORTED', request: {} }))
    await picked(['A01', 'A02'])
    await store.ask(); await store.start()
    expect(store.run.items[0]).toMatchObject({ outcome: 'unknown', lost: true })
    expect(Number.isFinite(store.run.items[0].sentAt)).toBe(true) // 서버의 기록이 없어도 화면이 보낸 시각으로 "등록 확인 중 → 아직 기록 없음 → 기록 없음" 이 흐른다
    expect(store.run.items[1].outcome).toBe('accepted')
    expect(api.testRunRequest).toHaveBeenCalledTimes(2)
  })
  it('모름·연결 못 함이 연달아 세 번이면 멈추고 남은 설비는 보내지 않는다', async () => {
    api.testRunRequest.mockImplementation(() => ok({ outcome: 'unknown' }))
    await picked(['A01', 'A02', 'A03', 'A04'])
    await store.ask(); await store.start()
    expect(api.testRunRequest).toHaveBeenCalledTimes(3)
    expect(store.run.items.map((x) => x.outcome)).toEqual(['unknown', 'unknown', 'unknown', 'skipped'])
    expect(store.run.halt).toEqual({ key: 'SEW_RUN_HALT_STREAK' })
    expect(store.stage).toBe('done')
  })
  it('429(다른 실행 요청이 돈다)는 1초 뒤 같은 설비를 다시 보낸다 — 스무 번을 넘기면 멈춘다', async () => {
    vi.useFakeTimers()
    api.testRunRequest.mockImplementationOnce(() => fail(429, 'TEST_RUN_BUSY', { scope: 'server' })).mockImplementationOnce(() => fail(429, 'TEST_RUN_BUSY')).mockImplementation(() => ok({ outcome: 'accepted' }))
    await picked(['A01'])
    await store.ask()
    const done = store.start()
    await vi.advanceTimersByTimeAsync(2100)
    await done
    expect(api.testRunRequest).toHaveBeenCalledTimes(3)
    expect(store.run.items[0].outcome).toBe('accepted')

    setup()
    api.testRunRequest.mockReset()
    api.testRunRequest.mockImplementation(() => fail(429, 'TEST_RUN_BUSY'))
    await picked(['A01', 'A02'])
    await store.ask()
    const stuck = store.start()
    await vi.advanceTimersByTimeAsync(25_000)
    await stuck
    expect(api.testRunRequest).toHaveBeenCalledTimes(21)
    expect(store.run.items.map((x) => x.outcome)).toEqual(['skipped', 'skipped'])
    expect(store.run.halt).toEqual({ key: 'SEW_RUN_HALT_BUSY' })
  })
  it('요청 전체가 막히는 오류(그 사이 권한을 잃음·시나리오가 꺼짐)는 그 자리에서 멈추고 까닭을 남긴다', async () => {
    api.testRunRequest.mockImplementationOnce(() => ok({ outcome: 'accepted' })).mockImplementationOnce(() => fail(409, 'TEST_RUN_SCENARIO_OFF'))
    await picked()
    await store.ask(); await store.start()
    expect(store.run.items.map((x) => x.outcome)).toEqual(['accepted', 'skipped', 'skipped'])
    expect(store.run.halt.key).toBe('SEW_RUN_HALT_ERROR')
    expect(store.run.halt.params.message).toContain('꺼져')
    expect(api.testRunRequest).toHaveBeenCalledTimes(2)
  })
  it('[중지]: 보내는 중인 설비는 끝까지 기다리고 남은 설비는 보내지 않는다', async () => {
    const gate = defer()
    api.testRunRequest.mockImplementationOnce(() => gate.promise)
    await picked()
    await store.ask()
    const done = store.start()
    await flushPromises()
    store.stop()
    gate.resolve({ data: { data: { outcome: 'accepted' } } })
    await done
    expect(store.run.items.map((x) => x.outcome)).toEqual(['accepted', 'skipped', 'skipped'])
    expect(store.run.halt).toEqual({ key: 'SEW_RUN_HALT_USER' })
    expect(api.testRunRequest).toHaveBeenCalledTimes(1)
  })
  it('창을 닫으면(보내는 중) 남은 설비를 보내지 않는다. 다시 열면 마지막 결과가 보인다', async () => {
    const gate = defer()
    api.testRunRequest.mockImplementationOnce(() => gate.promise)
    await picked(['A01', 'A02'])
    await store.ask()
    const done = store.start()
    await flushPromises()
    expect(store.pending).toBe(2)
    store.hide()
    gate.resolve({ data: { data: { outcome: 'accepted' } } })
    await done
    expect(api.testRunRequest).toHaveBeenCalledTimes(1)
    store.show()
    expect(store.stage).toBe('done')
    expect(store.run.items.map((x) => x.outcome)).toEqual(['accepted', 'skipped'])
  })
  it('[다시 고르기]: 고르기로 돌아가고 접수·모름이었던 설비의 선택을 푼다. 결과는 지운다', async () => {
    api.testRunRequest.mockImplementationOnce(() => ok({ outcome: 'accepted' })).mockImplementationOnce(() => ok({ outcome: 'failed', detail: 'x' })).mockImplementationOnce(() => ok({ outcome: 'off' }))
    await picked()
    await store.ask(); await store.start()
    store.pickAgain()
    await flushPromises()
    expect(store.stage).toBe('pick')
    expect([...store.picked].sort()).toEqual(['A02', 'A03'])
    expect(store.run).toBeNull()
    expect(api.testRunScenario).toHaveBeenCalledTimes(3) // 고를 때 · 확인으로 넘어갈 때 · 다시 고를 때(방금 요청을 다시 읽는다)
  })
})

describe('결과 메일 수신인(P5 설계 §4.5)', () => {
  const GROUPS = [{ category: 'CAT-A', source: 'equipment', eqpIds: ['A01', 'A02'], accounts: ['a@x.com'], problem: null }]
  it('시나리오와 설비를 고르면 0.3초 묶어서 한 번 받는다 — 설비 ID 순으로 보낸다', async () => {
    vi.useFakeTimers()
    api.testRunRecipients.mockImplementation(() => ok({ groups: GROUPS }))
    await ready()
    store.click('A02', {}); store.click('A01', { toggle: true })
    await vi.advanceTimersByTimeAsync(299)
    expect(api.testRunRecipients).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.testRunRecipients).toHaveBeenCalledTimes(1)
    expect(api.testRunRecipients).toHaveBeenCalledWith({ process: 'P1', model: 'M1', name: 'RUN_A', eqpIds: ['A01', 'A02'] })
    expect(store.recipients).toMatchObject({ status: 'ready', groups: GROUPS })
  })
  it('고른 설비가 없거나 시나리오를 고르지 않았으면 받지 않고 비운다', async () => {
    vi.useFakeTimers()
    await ready()
    store.click('A01', {})
    await vi.advanceTimersByTimeAsync(300)
    store.click('A01', { toggle: true })
    await vi.advanceTimersByTimeAsync(300)
    expect(api.testRunRecipients).toHaveBeenCalledTimes(1)
    expect(store.recipients).toMatchObject({ status: 'idle', groups: [] })
  })
  it('늦게 온 답은 버리고, 받지 못하면 오류를 남긴다', async () => {
    vi.useFakeTimers()
    const slow = defer()
    api.testRunRecipients.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fail(503, 'UPSTREAM_DOWN'))
    await ready()
    store.click('A01', {})
    await vi.advanceTimersByTimeAsync(300)
    store.click('A02', { toggle: true })
    await vi.advanceTimersByTimeAsync(300)
    slow.resolve({ data: { data: { groups: GROUPS } } })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.recipients.status).toBe('error')
    expect(store.recipients.groups).toEqual([])
  })
})

describe('실행 상태 다시 읽기', () => {
  const row = (eqpId, over = {}) => ({ eqpId, outcome: 'accepted', detail: null, sentAt: 4000, found: 0, status: null, retry: null, txnSeq: null, createDate: null, ...over })
  async function ran(ids = ['A01', 'A02']) {
    await ready()
    for (const id of ids) store.click(id, { toggle: true })
    await store.ask()
    await store.start()
  }
  it('보낸 뒤 실행 상태를 읽어 줄에 덮는다 — 찾은 줄은 pinned 로 다시 묻는다', async () => {
    vi.useFakeTimers()
    api.testRunStatus.mockImplementationOnce(() => statusOf([row('A01', { found: 1, status: 'Wait', txnSeq: 4100 }), row('A02')]))
      .mockImplementationOnce(() => statusOf([row('A01', { found: 1, status: 'Success', txnSeq: 4100 }), row('A02', { found: 1, status: 'StartScenario', txnSeq: 4200 })], 8000))
    await ran()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.testRunStatus).toHaveBeenCalledTimes(1)
    expect(api.testRunStatus.mock.calls[0][0]).toEqual({ runId: store.run.id, pinned: {} })
    expect(store.run.items[0]).toMatchObject({ status: 'Wait', txnSeq: 4100 })
    expect(store.run.now).toBe(5000)
    await vi.advanceTimersByTimeAsync(4900)
    expect(api.testRunStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(api.testRunStatus).toHaveBeenCalledTimes(2)
    expect(api.testRunStatus.mock.calls[1][0].pinned).toEqual({ A01: 4100 })
    expect(store.run.items.map((x) => x.status)).toEqual(['Success', 'StartScenario'])
  })
  it('모든 줄이 끝 상태면 그만 읽는다', async () => {
    vi.useFakeTimers()
    api.testRunStatus.mockImplementation(() => statusOf([row('A01', { found: 1, status: 'Success', txnSeq: 1 }), row('A02', { found: 1, status: 'Failed', txnSeq: 2 })]))
    await ran()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.testRunStatus).toHaveBeenCalledTimes(1)
  })
  it('보낸 것이 없으면(모두 보내지 않음) 읽지 않는다', async () => {
    vi.useFakeTimers()
    api.testRunRequest.mockImplementation(() => ok({ outcome: 'off' }))
    await ran()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.testRunStatus).not.toHaveBeenCalled()
  })
  it('마지막 요청 뒤 15분이 지나면 저절로 읽기를 멈추고 알린다(autoEnded) — [상태 조회] 는 그때마다 한 번만 읽는다', async () => {
    vi.useFakeTimers()
    api.testRunStatus.mockImplementation(() => statusOf([row('A01', { found: 1, status: 'StartScenario', txnSeq: 1 }), row('A02', { found: 1, status: 'Success', txnSeq: 2 })]))
    await ran()
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect(store.run.autoEnded).toBe(false)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(store.run.autoEnded).toBe(true)
    const n = api.testRunStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(api.testRunStatus).toHaveBeenCalledTimes(n)
    await store.refreshStatus()
    expect(api.testRunStatus).toHaveBeenCalledTimes(n + 1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.testRunStatus).toHaveBeenCalledTimes(n + 1)
    // 그 뒤 모두 끝 상태가 되면 알림을 거둔다
    api.testRunStatus.mockImplementation(() => statusOf([row('A01', { found: 1, status: 'Success', txnSeq: 1 }), row('A02', { found: 1, status: 'Success', txnSeq: 2 })]))
    await store.refreshStatus()
    expect(store.run.autoEnded).toBe(false)
  })
  it('15분 전에 모두 끝 상태가 되면 멈춰도 알리지 않는다', async () => {
    vi.useFakeTimers()
    api.testRunStatus.mockImplementation(() => statusOf([row('A01', { found: 1, status: 'Success', txnSeq: 1 }), row('A02', { found: 1, status: 'Failed', txnSeq: 2 })]))
    await ran()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(store.run.autoEnded).toBe(false)
  })
  it('조회가 실패하면 저절로 다시 읽기를 멈추고 알린다 — [상태 조회] 로 다시 읽는다', async () => {
    vi.useFakeTimers()
    api.testRunStatus.mockImplementationOnce(() => fail(503, 'TEST_RUN_STATUS_FAILED'))
    await ran()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.testRunStatus).toHaveBeenCalledTimes(1)
    expect(store.run.statusFailed).toBe(true)
    api.testRunStatus.mockImplementation(() => statusOf([row('A01', { found: 1, status: 'Success', txnSeq: 1 }), row('A02', { found: 1, status: 'Success', txnSeq: 2 })]))
    await store.refreshStatus()
    expect(store.run.statusFailed).toBe(false)
    expect(store.run.items[0].status).toBe('Success')
  })
  it('서버에 이 실행의 기록이 없다(404)는 실패가 아니다 — 응답을 놓친 요청이 기록 전에 끝난 것이다', async () => {
    vi.useFakeTimers()
    api.testRunRequest.mockImplementation(() => Promise.reject({ code: 'ECONNABORTED', request: {} }))
    api.testRunStatus.mockImplementation(() => fail(404, 'NOT_FOUND'))
    await ran(['A01'])
    await vi.advanceTimersByTimeAsync(0)
    expect(api.testRunStatus).toHaveBeenCalledTimes(1)
    expect(store.run.statusFailed).toBe(false)
    expect(store.run.items[0]).toMatchObject({ outcome: 'unknown', lost: true })
  })
  it('창을 닫으면 멈추고, 다시 열면 한 번 읽는다', async () => {
    vi.useFakeTimers()
    api.testRunStatus.mockImplementation(() => statusOf([row('A01', { found: 1, status: 'Wait', txnSeq: 1 }), row('A02')]))
    await ran()
    await vi.advanceTimersByTimeAsync(0)
    store.hide()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.testRunStatus).toHaveBeenCalledTimes(1)
    store.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.testRunStatus).toHaveBeenCalledTimes(2)
  })
  it('응답을 놓친 설비의 결과를 서버의 요청 기록으로 고친다', async () => {
    vi.useFakeTimers()
    api.testRunRequest.mockImplementationOnce(() => Promise.reject({ code: 'ECONNABORTED', request: {} }))
    api.testRunStatus.mockImplementation(() => statusOf([row('A01', { outcome: 'accepted', found: 1, status: 'Success', txnSeq: 9 })]))
    await ran(['A01'])
    await vi.advanceTimersByTimeAsync(0)
    expect(store.run.items[0]).toMatchObject({ outcome: 'accepted', lost: false, status: 'Success' })
  })
})
