import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ check: vi.fn(), saveDraft: vi.fn(), deploy: vi.fn(), verifyDeploy: vi.fn(), finishDeploy: vi.fn(), open: vi.fn(), nameRule: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import { useSaveFlow, overwriteDiff, PENDING_KEY, CHECK_DELAY_MS } from '../stores/saveFlow'
import { unsavedChanges } from '../editor/diff'
import { MESSAGES } from '../messages'
import { panelFixture, imageStep, noneStep } from './panelFixture'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code, details) => Promise.reject({ response: { status, data: { code, details } }, request: {} })
const clean = (over = {}) => ({ blocks: [], warns: [], target: { exists: true, eqpCount: 3 }, conflict: null, targetExists: null, ...over })
const metaOf = (call) => JSON.parse(call[0].get('meta'))
const lastMeta = (fn) => metaOf(fn.mock.calls[fn.mock.calls.length - 1])
const defer = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }

// 배포한 판을 다시 연 뼈대(같은 스텝, 새 crtime)
const reopened = (name = 'N', crtime = 99) => {
  const steps = [imageStep(0, { condition: { ...imageStep(0).condition, image: { ...imageStep(0).condition.image, accept: 0.8 } } }), noneStep(1), noneStep(2)]
  const edited = { source: { process: 'P', model: 'M', name, crtime, fileId: 'F2' }, headCrtime: crtime, header: { description: '', timeoutLimit: '1' }, steps, property: {} }
  return { process: 'P', model: 'M', name, id: `P-M-${name}`, headCrtime: crtime, propertyRev: 'r2', version: { crtime, isCurrent: true, fileId: 'F2' }, notes: [], steps: steps.map((s, i) => ({ ...s, no: i + 1, notes: [] })), edited }
}

function setup(check = clean()) {
  const f = panelFixture([imageStep(0), noneStep(1), noneStep(2)])
  f.s.scopes = { processes: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }, { model: 'M2', eqpCount: 5 }] }] }
  f.e.editCell('s0', 'accept', 0.8) // 저장 전 변경 하나
  api.check.mockImplementation(() => ok(typeof check === 'function' ? check() : check))
  api.nameRule.mockReturnValue(ok({ exists: false, rules: [] }))
  return { ...f, flow: useSaveFlow() }
}
async function toUnknown(flow) {
  api.deploy.mockImplementationOnce((fd) => fail(504, 'UPSTREAM_TIMEOUT', { requestId: JSON.parse(fd.get('meta')).requestId }))
  flow.open(); await flushPromises()
  flow.toConfirm()
  await flow.deploy()
  return flow.requestId
}

describe('saveFlow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    sessionStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('창을 열면 검사를 한 번(기준 판과 같은 대상) — 막힘이 있으면 배포는 막히고 초안은 된다', async () => {
    const { flow } = setup(clean({ blocks: [{ code: 'NEXT_UNRESOLVED', uid: 's1', params: { which: 'onTrue' } }] }))
    flow.open()
    await flushPromises()
    expect(flow.stage).toBe('form')
    expect(api.check).toHaveBeenCalledTimes(1)
    const meta = api.check.mock.calls[0][0]
    expect(meta.target).toEqual({ process: 'P', model: 'M', name: 'N' })
    expect(meta.force).toBe(false)
    expect(meta.scenario.steps[0].condition.image.accept).toBe(0.8)
    expect(flow.deployBlock).toEqual({ key: 'SEW_SAVE_WHY_BLOCKS', params: { n: 1 } })
    expect(flow.canDraft).toBe(true)
    flow.toConfirm()
    expect(flow.stage).toBe('form')
  })

  it('대상(모델·이름)을 바꾸면 입력이 멈춘 뒤 300ms 에 다시 검사하고, 다른 이름은 대상 상태를 다시 본다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { flow } = setup()
    flow.open()
    await flushPromises()
    expect(api.check).toHaveBeenCalledTimes(1)
    flow.setTarget({ name: 'COP' })
    flow.setTarget({ name: 'COPY' })
    vi.advanceTimersByTime(CHECK_DELAY_MS - 1)
    expect(api.check).toHaveBeenCalledTimes(1)
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_CHECKING') // 지난 검사는 다른 대상의 것
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(api.check).toHaveBeenCalledTimes(2)
    expect(api.check.mock.calls[1][0].target).toEqual({ process: 'P', model: 'M', name: 'COPY' })
    expect(flow.deployBlock).toBe(null)
    // 칸 오류(쓸 수 없는 글자)면 검사를 부르지 않는다
    flow.setTarget({ name: 'A-B' })
    vi.advanceTimersByTime(CHECK_DELAY_MS)
    await flushPromises()
    expect(api.check).toHaveBeenCalledTimes(2)
    expect(flow.fieldErrors.name.code).toBe('NAME_CHARS')
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_FIELDS')
    expect(flow.canDraft).toBe(false)
  })

  it('이미 있는 이름(TARGET_EXISTS) → 덮어쓰기 확인 칸이 생기고, 체크해야 배포하며 overwrite 를 싣는다', async () => {
    const diff = [{ key: 'IsEnabled', from: false, to: true }]
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    expect(flow.stage).toBe('confirm')
    api.deploy.mockImplementationOnce(() => fail(409, 'TARGET_EXISTS', { diff }))
    await flow.deploy()
    expect(flow.stage).toBe('form')
    expect(flow.check.targetExists).toEqual({ diff })
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_OVERWRITE')
    expect(flow.notice.key).toBe('SEW_SAVE_BACK_TARGET_EXISTS')
    flow.setOverwrite(true)
    expect(flow.deployBlock).toBe(null)
    api.deploy.mockImplementationOnce(() => ok({ result: 'ok', crtime: 99, partialFailed: [] }))
    api.open.mockReturnValue(ok(reopened()))
    flow.toConfirm()
    await flow.deploy()
    expect(lastMeta(api.deploy).overwrite).toBe(true)
    expect(flow.stage).toBe('ok')
  })

  it('배포 meta: requestId(uuid)·overwrite·force·restoredFrom, 그림은 쓰는 것만 — 멀티파트로 보낸다', async () => {
    const { flow, e } = setup()
    e.setUpload('t1', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => ok({ result: 'ok', crtime: 99, partialFailed: [] }))
    api.open.mockReturnValue(ok(reopened()))
    await flow.deploy()
    const fd = api.deploy.mock.calls[0][0]
    expect(fd).toBeInstanceOf(FormData)
    const meta = metaOf(api.deploy.mock.calls[0])
    expect(meta.requestId).toMatch(UUID)
    expect(meta).toMatchObject({ overwrite: false, force: false, restoredFrom: null, target: { process: 'P', model: 'M', name: 'N' }, propertyRev: null })
    expect(meta.scenario.source).toEqual({ process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' })
    expect(fd.get('img:t1')).toBe(null) // 작업본이 가리키지 않는 그림은 싣지 않는다
  })

  it('504(details.requestId) → 결과 모름, requestId 를 세션 저장소에 둔다 — 자동으로 다시 보내지 않는다', async () => {
    const { flow } = setup()
    const id = await toUnknown(flow)
    expect(flow.stage).toBe('unknown')
    expect(id).toMatch(UUID)
    expect(api.deploy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY))).toMatchObject({ requestId: id, target: { process: 'P', model: 'M', name: 'N' } })
  })

  it('확인 mine → 성공 화면, 세션 기준을 새 판으로(rebase) — 올릴 그림을 비우고 저장 전 변경이 없다', async () => {
    const { flow, e, s } = setup()
    e.setUpload('t9', new Blob([new Uint8Array([1])]))
    const id = await toUnknown(flow)
    api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 99, result: 'ok', partialFailed: [] }))
    api.open.mockReturnValue(ok(reopened()))
    await flow.verify()
    expect(api.verifyDeploy).toHaveBeenCalledWith(id)
    expect(api.open).toHaveBeenCalledWith('P', 'M', 'N', 99)
    expect(flow.stage).toBe('ok')
    expect(flow.result).toMatchObject({ result: 'ok', crtime: 99 })
    expect(e.session.source).toMatchObject({ name: 'N', crtime: 99, fileId: 'F2' })
    expect(e.session.headCrtime).toBe(99)
    expect(e.session.propertyRev).toBe('r2')
    expect(e.uploads.size).toBe(0)
    expect(unsavedChanges(e.session.working, e.session.saveBase)).toEqual([])
    expect(s.skeleton.version.crtime).toBe(99)
    expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
  })

  it('확인 none → [다시 배포] 는 새 requestId 로 보낸다(다시 보내기 전 세션 저장소의 옛 id 를 지운다)', async () => {
    const { flow } = setup()
    const first = await toUnknown(flow)
    api.verifyDeploy.mockReturnValue(ok({ found: 'none', crtime: null }))
    await flow.verify()
    expect(flow.stage).toBe('unknown')
    expect(flow.result).toEqual({ found: 'none' })
    flow.redeploy()
    expect(flow.stage).toBe('confirm')
    expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
    api.deploy.mockImplementationOnce(() => ok({ result: 'ok', crtime: 99, partialFailed: [] }))
    api.open.mockReturnValue(ok(reopened()))
    await flow.deploy()
    const second = lastMeta(api.deploy).requestId
    expect(second).toMatch(UUID)
    expect(second).not.toBe(first)
    expect(flow.stage).toBe('ok')
  })

  it('확인 404(기록 없음) → 보내지 않은 것 — 다시 배포할 수 있고 세션 저장소를 비운다. 409(처리 중)는 알림만', async () => {
    const { flow } = setup()
    await toUnknown(flow)
    api.verifyDeploy.mockImplementationOnce(() => fail(409, 'SAVE_IN_PROGRESS'))
    await flow.verify()
    expect(flow.stage).toBe('unknown')
    expect(flow.notice.key).toBe('SEW_SAVE_VERIFY_BUSY')
    api.verifyDeploy.mockImplementationOnce(() => fail(404, 'NOT_FOUND'))
    await flow.verify()
    expect(flow.result).toEqual({ found: 'none', noRecord: true })
    expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
  })

  it('새로고침 뒤(새 저장소) — 세션 저장소의 requestId 로 결과 모름 화면이 다시 열리고 확인할 수 있다. 화면은 배포한 내용이 아니라 기준을 바꾸지 않는다', async () => {
    const { flow } = setup()
    const id = await toUnknown(flow)
    setActivePinia(createPinia())
    const again = setup()
    again.flow.open()
    await flushPromises()
    expect(again.flow.stage).toBe('unknown')
    expect(again.flow.requestId).toBe(id)
    expect(again.flow.restored).toBe(true)
    api.check.mockClear()
    api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 99, result: 'ok', partialFailed: [] }))
    await again.flow.verify()
    expect(api.verifyDeploy).toHaveBeenCalledWith(id)
    expect(again.flow.stage).toBe('ok')
    expect(api.open).not.toHaveBeenCalled()
    expect(again.e.session.source.crtime).toBe(1)
    expect(again.flow.notice.key).toBe('SEW_SAVE_NOT_REBASED')
  })

  it('partial → [다시 쓰기] → 성공', async () => {
    const { flow, e } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => ok({ result: 'partial', crtime: 99, partialFailed: ['finish'] }))
    api.open.mockReturnValue(ok(reopened()))
    await flow.deploy()
    expect(flow.stage).toBe('partial')
    expect(e.session.source.crtime).toBe(99) // 설비에는 갔다 — 기준은 새 판
    const id = flow.requestId
    api.finishDeploy.mockReturnValue(ok({ result: 'ok', crtime: 99, partialFailed: [] }))
    await flow.finish()
    expect(api.finishDeploy).toHaveBeenCalledWith(id)
    expect(flow.stage).toBe('ok')
  })

  it('다시 쓰기 오류는 code 와 상관없이(504 도) "아직 마무리 안 됨" — partial 에 남아 다시 쓸 수 있다. 200 partial 은 쓸 문서가 없음', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => ok({ result: 'partial', crtime: 99, partialFailed: ['finish'] }))
    api.open.mockReturnValue(ok(reopened()))
    await flow.deploy()
    api.finishDeploy.mockImplementationOnce(() => fail(504, 'UPSTREAM_TIMEOUT'))
    await flow.finish()
    expect(flow.stage).toBe('partial')
    expect(flow.notice.key).toBe('SEW_SAVE_FINISH_FAILED')
    expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
    api.finishDeploy.mockImplementationOnce(() => ok({ result: 'partial', crtime: 99, partialFailed: ['finish'] }))
    await flow.finish()
    expect(flow.stage).toBe('partial')
    expect(flow.notice.key).toBe('SEW_SAVE_FINISH_NO_DOC')
  })

  it('503 → 배포 실패(보내지 않음). 저장 창 문구 어디에도 "잠시 뒤" 가 없다', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => fail(503, 'UPSTREAM_DOWN'))
    await flow.deploy()
    expect(flow.stage).toBe('fail')
    expect(flow.error).toMatchObject({ kind: 'notSent', code: 'UPSTREAM_DOWN' })
    expect(flow.error.cause).not.toContain('잠시 뒤')
    expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
    const saveCopy = Object.entries(MESSAGES).filter(([k]) => k.startsWith('SEW_SAVE_') || k.startsWith('SEW_NAME_'))
    expect(saveCopy.length).toBeGreaterThan(40)
    for (const [k, v] of saveCopy) expect(v, k).not.toContain('잠시 뒤')
  })

  it('requestId 가 없는 504(보내기 전 DB 시간 초과) → 보내지 않음', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => fail(504, 'UPSTREAM_TIMEOUT'))
    await flow.deploy()
    expect(flow.stage).toBe('fail')
    expect(flow.error.kind).toBe('notSent')
    expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
  })

  it('502 → 배포 실패(거절) — 서버 문구를 함께 두고, [버전 목록 확인]은 내 requestId 로', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => fail(502, 'UPSTREAM_FAILED', { upstreamText: 'scenario save failed: disk full' }))
    await flow.deploy()
    const id = metaOf(api.deploy.mock.calls[0]).requestId
    expect(flow.stage).toBe('fail')
    expect(flow.error).toMatchObject({ kind: 'rejected', upstreamText: 'scenario save failed: disk full' })
    expect(flow.requestId).toBe(id)
    api.verifyDeploy.mockReturnValue(ok({ found: 'none', crtime: null }))
    await flow.verify()
    expect(api.verifyDeploy).toHaveBeenCalledWith(id)
    expect(flow.stage).toBe('fail')
    expect(flow.result).toEqual({ found: 'none' })
  })

  it('409 SAVE_IN_PROGRESS: 같은 requestId(details.requestId)면 결과 모름으로 확인하게, 다른 배포가 진행 중이면 저장 창으로', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => fail(409, 'SAVE_IN_PROGRESS', { requestId: '11111111-2222-4333-8444-555555555555' }))
    await flow.deploy()
    expect(flow.stage).toBe('unknown')
    expect(flow.requestId).toBe('11111111-2222-4333-8444-555555555555')
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)).requestId).toBe('11111111-2222-4333-8444-555555555555')
    flow.redeploy()
    api.deploy.mockImplementationOnce(() => fail(409, 'SAVE_IN_PROGRESS'))
    await flow.deploy()
    expect(flow.stage).toBe('form')
    expect(flow.notice.key).toBe('SEW_SAVE_BACK_IN_PROGRESS')
  })

  it('응답 없이 끊김(브라우저 시간 초과 등) → 보냈는지 모름 — 결과 모름, 내 requestId 로 확인', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => Promise.reject({ code: 'ECONNABORTED', request: {} }))
    await flow.deploy()
    expect(flow.stage).toBe('unknown')
    expect(flow.requestId).toBe(metaOf(api.deploy.mock.calls[0]).requestId)
  })

  it('422 VALIDATION_FAILED·409 SAVE_CONFLICT → 저장 창으로 돌아가 막힘·충돌을 그린다', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => fail(422, 'VALIDATION_FAILED', { blocks: [{ code: 'BODY_TOO_LARGE', params: { bytes: 20, max: 15 } }] }))
    await flow.deploy()
    expect(flow.stage).toBe('form')
    expect(flow.check.blocks).toEqual([{ code: 'BODY_TOO_LARGE', params: { bytes: 20, max: 15 } }])
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_BLOCKS')
    // 막힘이 풀린 다음 배포에서 그 사이 다른 사람이 저장했다
    flow.check = clean()
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => fail(409, 'SAVE_CONFLICT', { conflict: { kind: 'newVersion', by: 'sew_cvd', at: '2026-11-09 10:00:00' } }))
    await flow.deploy()
    expect(flow.stage).toBe('form')
    expect(flow.check.conflict).toEqual({ kind: 'newVersion', by: 'sew_cvd', at: '2026-11-09 10:00:00' })
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_FORCE')
    flow.setForce(true) // 확인 표시가 바뀌면 그 값으로 다시 검사한다(기준 판이 지워졌으면 캐시를 쓰는지가 달라진다)
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_CHECKING')
    await flushPromises()
    expect(flow.deployBlock).toBe(null)
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => ok({ result: 'ok', crtime: 99, partialFailed: [] }))
    api.open.mockReturnValue(ok(reopened()))
    await flow.deploy()
    expect(lastMeta(api.deploy).force).toBe(true)
  })

  it('다른 이름으로 배포 성공 → 열린 시나리오의 기준·ID·바가 새 이름으로 바뀌고(DC-025), 원본(요청의 기준 판)은 그대로', async () => {
    const { flow, e, s } = setup(() => clean({ target: { exists: false, eqpCount: 3 } }))
    flow.open(); await flushPromises()
    flow.setTarget({ name: 'COPY' })
    await flow.runCheck()
    expect(api.check.mock.calls[1][0].force).toBe(true) // 다른 대상은 확인할 충돌이 없다 — 기준 판 파일이 지워졌으면 캐시로 읽게
    flow.toConfirm()
    api.deploy.mockImplementationOnce(() => ok({ result: 'ok', crtime: 5, partialFailed: [] }))
    api.open.mockReturnValue(ok(reopened('COPY', 5)))
    await flow.deploy()
    const meta = lastMeta(api.deploy)
    expect(meta.target).toEqual({ process: 'P', model: 'M', name: 'COPY' })
    expect(meta.scenario.source.name).toBe('N')
    expect(api.open).toHaveBeenCalledWith('P', 'M', 'COPY', 5)
    expect(e.session.source).toMatchObject({ name: 'COPY', crtime: 5 })
    expect(s.skeleton.name).toBe('COPY')
    expect(flow.stage).toBe('ok')
    flow.close()
    flow.open(); await flushPromises()
    expect(flow.target).toEqual({ model: 'M', name: 'COPY' })
  })

  it('삭제 충돌: SOURCE_GONE 이 [다시 만듭니다]를 가리지 않고, 체크하면 force 로 다시 검사해 캐시 유무를 안다', async () => {
    const gone = clean({ blocks: [{ code: 'SOURCE_GONE' }], conflict: { kind: 'deleted' }, target: { exists: false, eqpCount: 3 } })
    const { flow } = setup(gone)
    flow.open(); await flushPromises()
    expect(flow.visibleBlocks).toEqual([])
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_RECREATE')
    expect(flow.canDraft).toBe(true)
    // 캐시가 있다: force 검사에서 SOURCE_GONE 이 사라진다
    api.check.mockImplementationOnce(() => ok(clean({ conflict: { kind: 'deleted' }, target: { exists: false, eqpCount: 3 } })))
    flow.setForce(true)
    await flushPromises()
    expect(api.check).toHaveBeenCalledTimes(2)
    expect(api.check.mock.calls[1][0].force).toBe(true)
    expect(flow.deployBlock).toBe(null)
    expect(flow.recreateNoCache).toBe(false)
    // 캐시가 없다: force 로도 SOURCE_GONE — 배포는 막히고 초안만 된다
    flow.setForce(false)
    await flushPromises()
    api.check.mockImplementationOnce(() => ok(gone))
    flow.setForce(true)
    await flushPromises()
    expect(flow.visibleBlocks).toEqual([{ code: 'SOURCE_GONE' }])
    expect(flow.recreateNoCache).toBe(true)
    expect(flow.deployBlock.key).toBe('SEW_SAVE_WHY_BLOCKS')
    expect(flow.canDraft).toBe(true)
  })

  it('새 시나리오 첫 저장(출처 없음, 조작판 27): 대상은 열린 뼈대의 모델·이름, force 없음, 바뀐 것이 없어도 초안이 된다', async () => {
    const { flow, e, s } = setup(clean({ target: { exists: false, eqpCount: 3 } }))
    const steps = [noneStep(0)]
    const edited = { source: null, headCrtime: null, header: { description: '새 메일', timeoutLimit: '240' }, steps, property: {} }
    const sk = { process: 'P', model: 'M2', name: 'NEW_ONE', id: 'P-M2-NEW_ONE', headCrtime: null, propertyRev: null, version: {}, notes: [], steps: steps.map((x, i) => ({ ...x, no: i + 1, notes: [] })), edited }
    s.skeleton = sk
    e.begin(sk, s.me)
    e.session = { ...e.session, source: null, headCrtime: null } // 새 시나리오 세션은 Task 6(beginNew)이 만든다 — 여기서는 손으로
    expect(e.editable).toBe(true)
    flow.open(); await flushPromises()
    expect(flow.target).toEqual({ model: 'M2', name: 'NEW_ONE' })
    const meta = api.check.mock.calls[0][0]
    expect(meta.target).toEqual({ process: 'P', model: 'M2', name: 'NEW_ONE' })
    expect(meta.force).toBe(false)
    expect(meta.scenario.source).toBe(null)
    expect(flow.targetKind).toBe('new')
    expect(flow.changes.filter((c) => c.kind === 'field')).toEqual([]) // 출처가 없으면 바 칸·운영 속성 줄을 빼고 스텝은 모두 새 스텝
    expect(flow.canDraft).toBe(true)
    expect(flow.deployBlock).toBe(null)
  })

  it('덮어쓰기 차이: 저장된 빈 후속 {Name:""} 과 작업본 null 은 둘 다 "후속 없음" — 차이 줄이 아니다', () => {
    expect(overwriteDiff([
      { key: 'NextScenarioIfSuccess', from: { Name: '', Text: '' }, to: null },
      { key: 'NextScenarioIfFail', from: null, to: { Name: '', Text: 'x' } },
      { key: 'IsEnabled', from: false, to: true },
      { key: 'NextScenarioIfFail', from: { Name: '', Text: '' }, to: { Name: 'NEXT_SC', Text: '' } }
    ])).toEqual([
      { key: 'IsEnabled', from: false, to: true },
      { key: 'NextScenarioIfFail', from: { Name: '', Text: '' }, to: { Name: 'NEXT_SC', Text: '' } }
    ])
    expect(overwriteDiff(undefined)).toEqual([])
  })

  it('초안 저장: 막혀도 저장하고 바에 초안 시각을 남긴다 — 저장 전 변경(작업본)은 그대로, 요청은 멀티파트·requestId 없음', async () => {
    const { flow, e } = setup(clean({ blocks: [{ code: 'NO_SUCCESS' }] }))
    const before = unsavedChanges(e.session.working, e.session.saveBase)
    flow.open(); await flushPromises()
    api.saveDraft.mockReturnValue(ok({ draftId: 'd1', savedAt: '2026-11-09T05:23:00.000Z', revision: 1 }))
    await flow.saveDraft()
    const meta = metaOf(api.saveDraft.mock.calls[0])
    expect(meta.target).toEqual({ process: 'P', model: 'M', name: 'N' })
    expect(meta.requestId).toBeUndefined()
    expect(flow.stage).toBe('draft')
    expect(e.session.draft).toEqual({ id: 'd1', savedAt: '2026-11-09T05:23:00.000Z' })
    expect(unsavedChanges(e.session.working, e.session.saveBase)).toEqual(before)
  })

  it('초안 저장 실패는 창에 남아 알린다(같은 자리에 덮어쓰므로 다시 눌러도 된다)', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    api.saveDraft.mockImplementationOnce(() => fail(503, 'UPSTREAM_DOWN'))
    await flow.saveDraft()
    expect(flow.stage).toBe('form')
    expect(flow.notice).toMatchObject({ key: 'SEW_SAVE_DRAFT_FAILED', tone: 'error' })
    expect(flow.notice.params.cause).not.toContain('잠시 뒤')
  })

  it('배포 중에는 닫을 수 없고 초안도 저장할 수 없다', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.toConfirm()
    const d = defer()
    api.deploy.mockReturnValueOnce(d.promise)
    const p = flow.deploy()
    expect(flow.stage).toBe('run')
    expect(flow.closable).toBe(false)
    expect(flow.close()).toBe(false)
    expect(flow.canDraft).toBe(false)
    expect(flow.stage).toBe('run')
    api.open.mockReturnValue(ok(reopened()))
    d.resolve({ data: { data: { result: 'ok', crtime: 99, partialFailed: [] } } })
    await p
    expect(flow.close()).toBe(true)
    expect(flow.stage).toBe(null)
  })

  it('닫기: 입력한 대상은 버린다. 초안·실패·결과 모름 뒤, 막힌 줄로 가려고 닫을 때는 남긴다', async () => {
    const { flow } = setup()
    flow.open(); await flushPromises()
    flow.setTarget({ name: 'KEEP_ME' })
    flow.close()
    flow.open(); await flushPromises()
    expect(flow.target.name).toBe('N')
    flow.setTarget({ name: 'KEEP_ME' })
    flow.close({ keep: true })
    flow.open(); await flushPromises()
    expect(flow.target.name).toBe('KEEP_ME')
    // 다른 시나리오(새 세션)를 열면 남긴 대상은 쓰지 않는다
    flow.close({ keep: true })
    const f = setup()
    f.e.begin({ ...f.skeleton, name: 'OTHER', edited: { ...f.skeleton.edited, source: { ...f.skeleton.edited.source, name: 'OTHER' } } }, f.s.me)
    flow.open(); await flushPromises()
    expect(flow.target.name).toBe('OTHER')
  })

  it('결과 모름 뒤 작업본을 고쳤으면 확인이 mine 이어도 기준을 바꾸지 않는다(보낸 내용이 아니다)', async () => {
    const { flow, e } = setup()
    await toUnknown(flow)
    flow.close()
    e.editCell('s1', 'skip', true)
    flow.open()
    expect(flow.stage).toBe('unknown')
    expect(flow.restored).toBe(true)
    api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 99, result: 'ok', partialFailed: [] }))
    await flow.verify()
    expect(flow.stage).toBe('ok')
    expect(api.open).not.toHaveBeenCalled()
    expect(e.session.source.crtime).toBe(1)
  })
})
