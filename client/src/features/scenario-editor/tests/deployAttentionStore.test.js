import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ deployAttention: vi.fn(), verifyDeploy: vi.fn(), finishDeploy: vi.fn(), dismissDeploy: vi.fn(), getDraft: vi.fn(), check: vi.fn(), nameRule: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import { useDeployAttention } from '../stores/deployAttentionStore'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { PENDING_KEY } from '../stores/saveFlow'
import { panelFixture, imageStep } from './panelFixture'

// 확인이 필요한 내 배포(SEW-021) — 결과 모름·마무리 실패·거절을 새로고침·탭 닫기 뒤에도 찾아 확인·다시 쓰기
const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code, details) => Promise.reject({ response: { status, data: { code, details } }, request: {} })
const RID = '11111111-2222-4333-8444-555555555555'
const RID2 = '11111111-2222-4333-8444-666666666666'
const item = (o = {}) => ({ requestId: RID, target: { process: 'P', model: 'M', name: 'N' }, startedAt: '2026-11-19T01:02:03.000Z', result: 'unknown', crtime: null, targetWasNew: false, ...o })

function setup({ canWrite = true, items = [item()] } = {}) {
  setActivePinia(createPinia())
  Object.values(api).forEach((f) => f.mockReset())
  sessionStorage.clear()
  api.deployAttention.mockImplementation(() => ok({ items: items.map((i) => ({ ...i })) }))
  const editor = useEditorStore()
  editor.me = { singleid: 'u', canWrite }
  return { editor, store: useDeployAttention() }
}

describe('deployAttentionStore', () => {
  beforeEach(() => { vi.useRealTimers() })

  it('쓰기 사용자면 처음 쓸 때 목록을 받는다 — count 는 아직 끝나지 않은 줄 수', async () => {
    const { store } = setup({ items: [item(), item({ requestId: RID2, result: 'partial', crtime: 99, targetWasNew: true })] })
    await flushPromises()
    expect(api.deployAttention).toHaveBeenCalledTimes(1)
    expect(store.items.map((i) => i.requestId)).toEqual([RID, RID2])
    expect(store.count).toBe(2)
  })
  it('쓰기 권한이 없으면 묻지 않고 비어 있다', async () => {
    const { store } = setup({ canWrite: false })
    await flushPromises()
    expect(api.deployAttention).not.toHaveBeenCalled()
    expect(store.count).toBe(0)
  })
  it('목록을 받지 못하면 앞의 목록을 두고 failed 를 알린다', async () => {
    const { store } = setup()
    await flushPromises()
    api.deployAttention.mockReturnValueOnce(fail(503, 'UPSTREAM_DOWN'))
    await store.refresh()
    expect(store.failed).toBe(true)
    expect(store.items).toHaveLength(1)
  })

  describe('확인(verify)', () => {
    it('배포됐고 마무리까지 끝났으면(mine·ok) 그 줄은 끝남 — count 에서 빠지고, 이 탭에 남은 같은 결과 모름 기억도 지운다', async () => {
      const { store } = setup()
      await flushPromises()
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ requestId: RID, target: { process: 'P', model: 'M', name: 'N' }, at: 1 }))
      api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 99, result: 'ok', partialFailed: [] }))
      await store.verify(RID)
      expect(api.verifyDeploy).toHaveBeenCalledWith(RID)
      expect(store.items[0].outcome).toEqual({ kind: 'ok', crtime: 99, performanceKept: false, draftGone: false })
      expect(store.count).toBe(0)
      expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
    })
    it('늦은 확인이라 성과를 덮지 않았으면(performanceKept) 그렇게 알린다', async () => {
      const { store } = setup()
      await flushPromises()
      api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 99, result: 'ok', partialFailed: [], performanceKept: true }))
      await store.verify(RID)
      expect(store.items[0].outcome.performanceKept).toBe(true)
    })
    it('배포는 됐는데 마무리가 실패했으면(mine·partial) 그 줄은 마무리 실패가 되어 [다시 쓰기]', async () => {
      const { store } = setup()
      await flushPromises()
      api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 99, result: 'partial', partialFailed: ['finish'] }))
      await store.verify(RID)
      expect(store.items[0]).toMatchObject({ result: 'partial', crtime: 99, outcome: null })
      expect(store.count).toBe(1)
    })
    it('배포되지 않았으면(none) 그렇게 알리고 줄은 남는다(빼기·다시 배포는 사용자가)', async () => {
      const { store } = setup()
      await flushPromises()
      api.verifyDeploy.mockReturnValue(ok({ found: 'none', crtime: null }))
      await store.verify(RID)
      expect(store.items[0].outcome).toEqual({ kind: 'none' })
      expect(store.count).toBe(1)
    })
    it('다른 곳에서 처리하는 중(409 SAVE_IN_PROGRESS)·그 밖의 실패는 이유를 줄에 남긴다', async () => {
      const { store } = setup()
      await flushPromises()
      api.verifyDeploy.mockReturnValueOnce(fail(409, 'SAVE_IN_PROGRESS'))
      await store.verify(RID)
      expect(store.items[0].outcome).toEqual({ kind: 'busy' })
      api.verifyDeploy.mockReturnValueOnce(fail(503, 'UPSTREAM_DOWN'))
      await store.verify(RID)
      expect(store.items[0].outcome).toMatchObject({ kind: 'error' })
      expect(store.items[0].outcome.cause).toBeTruthy()
    })
    it('확인하는 동안 그 줄은 busy — 두 번 눌러도 한 번만 보낸다', async () => {
      const { store } = setup()
      await flushPromises()
      let resolve
      api.verifyDeploy.mockReturnValue(new Promise((r) => { resolve = r }))
      const p = store.verify(RID)
      expect(store.items[0].busy).toBe('verify')
      store.verify(RID)
      expect(api.verifyDeploy).toHaveBeenCalledTimes(1)
      resolve({ data: { data: { found: 'none', crtime: null } } })
      await p
      expect(store.items[0].busy).toBe(null)
    })
    it('배포를 확인한 뒤 편집 화면의 초안이 서버에서 지워졌으면(그 배포의 원본·대상 초안) 세션에서 떼고 그 사실을 줄에 남긴다', async () => {
      setup()
      const f = panelFixture([imageStep(0)])
      f.e.markDraft({ draftId: 'd1', savedAt: '2026-11-19T01:00:00.000Z' })
      const store = useDeployAttention()
      await flushPromises()
      api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 99, result: 'ok', partialFailed: [] }))
      api.getDraft.mockReturnValue(fail(404, 'NOT_FOUND'))
      await store.verify(RID)
      expect(useEditStore().session.draft).toBe(null)
      expect(store.items[0].outcome.draftGone).toBe(true)
    })
  })

  describe('다시 쓰기(finish)', () => {
    it('마무리 실패 줄을 다시 쓰면(ok) 끝남', async () => {
      const { store } = setup({ items: [item({ result: 'partial', crtime: 99, targetWasNew: true })] })
      await flushPromises()
      api.finishDeploy.mockReturnValue(ok({ result: 'ok', crtime: 99, partialFailed: [] }))
      await store.finish(RID)
      expect(api.finishDeploy).toHaveBeenCalledWith(RID)
      expect(store.items[0].outcome).toMatchObject({ kind: 'ok', crtime: 99 })
      expect(store.count).toBe(0)
    })
    it('DB 는 답했는데 쓸 운영 속성 문서가 없으면(partial) 그렇게 알린다', async () => {
      const { store } = setup({ items: [item({ result: 'partial', crtime: 99 })] })
      await flushPromises()
      api.finishDeploy.mockReturnValue(ok({ result: 'partial', crtime: 99, partialFailed: ['finish'] }))
      await store.finish(RID)
      expect(store.items[0].outcome).toEqual({ kind: 'stillPartial' })
    })
  })

  describe('목록에서 빼기(dismiss)', () => {
    it('빼면 목록에서 사라지고 이 탭에 남은 같은 결과 모름 기억도 지운다', async () => {
      const { store } = setup({ items: [item(), item({ requestId: RID2 })] })
      await flushPromises()
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ requestId: RID, target: { process: 'P', model: 'M', name: 'N' }, at: 1 }))
      api.dismissDeploy.mockReturnValue(ok({ dismissed: true }))
      await store.dismiss(RID)
      expect(api.dismissDeploy).toHaveBeenCalledWith(RID)
      expect(store.items.map((i) => i.requestId)).toEqual([RID2])
      expect(sessionStorage.getItem(PENDING_KEY)).toBe(null)
    })
    it('다른 요청의 결과 모름 기억은 지우지 않는다', async () => {
      const { store } = setup()
      await flushPromises()
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ requestId: RID2, target: { process: 'P', model: 'M', name: 'N' }, at: 1 }))
      api.dismissDeploy.mockReturnValue(ok({ dismissed: true }))
      await store.dismiss(RID)
      expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)).requestId).toBe(RID2)
    })
    it('빼지 못하면 줄에 이유를 남기고 줄은 남는다', async () => {
      const { store } = setup()
      await flushPromises()
      api.dismissDeploy.mockReturnValue(fail(503, 'UPSTREAM_DOWN'))
      await store.dismiss(RID)
      expect(store.items).toHaveLength(1)
      expect(store.items[0].outcome).toMatchObject({ kind: 'error' })
    })
  })
})
