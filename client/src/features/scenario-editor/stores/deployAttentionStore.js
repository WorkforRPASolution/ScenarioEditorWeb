// 확인이 필요한 내 배포(SEW-021) — 결과 모름·마무리 실패·거절을 서버 기록에서 받아(GET /deploys/attention) 이어서 확인·다시 쓰기·빼기를 한다.
// 저장 창은 결과 모름의 requestId 를 그 탭의 세션 저장소에만 둬서, 탭을 닫거나 새로고침하면(그리고 다른 시나리오를 열면) 찾을 길이 없었다.
// 위쪽 바의 "확인할 배포 n건" 이 이 목록을 연다(components/DeployAttentionDialog.vue).
// 줄 = 서버 항목 { requestId, target, startedAt, result: 'unknown'|'partial'|'rejected', crtime, targetWasNew } + busy('verify'|'finish'|'dismiss'|null) + outcome:
//   { kind: 'ok', crtime, performanceKept, draftGone } 끝남(count 에서 빠진다) · { kind: 'partial', draftGone: true } 마무리 실패가 됨 + 편집 화면 초안이 지워짐
//   · { kind: 'none' } 배포되지 않음 · { kind: 'stillPartial' } 다시 쓸 문서가 없음 · { kind: 'busy' } 다른 곳에서 처리 중 · { kind: 'error', cause }
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { scenarioEditorApi as api } from '../api'
import { errorCode, errorMessage } from '../messages'
import { useEditorStore } from './editorStore'
import { useSaveFlow, forgetPending } from './saveFlow'

const ENDED = ['ok', 'partial', 'unknown', 'fail'] // 저장 창이 이 단계가 되거나 닫히면 목록을 다시 받는다

export const useDeployAttention = defineStore('scenarioEditorDeployAttention', () => {
  const editor = useEditorStore()
  const flow = useSaveFlow()
  const items = ref([])
  const failed = ref(false)
  const loading = ref(false)
  let seq = 0

  const count = computed(() => items.value.filter((i) => i.outcome?.kind !== 'ok').length)
  const find = (rid) => items.value.find((i) => i.requestId === rid)
  const patch = (rid, fields) => { items.value = items.value.map((i) => (i.requestId === rid ? { ...i, ...fields } : i)) }
  const failureOf = (e) => (errorCode(e) === 'SAVE_IN_PROGRESS' ? { kind: 'busy' } : { kind: 'error', cause: errorMessage(e) })

  // 받지 못하면 앞의 목록을 두고 failed. 쓰기 권한이 없으면 묻지 않는다(배포를 할 수 없다). 늦게 온 응답은 버린다.
  async function refresh() {
    const n = ++seq
    if (!editor.me?.canWrite) { items.value = []; failed.value = false; return }
    loading.value = true
    try {
      const data = (await api.deployAttention()).data.data
      if (n !== seq) return
      items.value = (data?.items ?? []).map((i) => ({ ...i, busy: null, outcome: null }))
      failed.value = false
    } catch {
      if (n === seq) failed.value = true
    } finally {
      if (n === seq) loading.value = false
    }
  }

  // [버전 목록 확인] — 저장 창의 확인과 같은 API. 배포를 확인하면 서버는 그 배포의 원본·대상의 내 초안을 지운다 — 편집 화면이 그 초안이면 뗀다(SEW-022).
  async function verify(rid) {
    const it = find(rid)
    if (!it || it.busy) return
    patch(rid, { busy: 'verify', outcome: null })
    try {
      const r = (await api.verifyDeploy(rid)).data.data
      if (r.found === 'mine') {
        forgetPending(rid)
        const draftGone = await flow.draftGone()
        if (r.result === 'partial') patch(rid, { result: 'partial', crtime: r.crtime ?? null, outcome: draftGone ? { kind: 'partial', draftGone: true } : null })
        else patch(rid, { result: 'ok', crtime: r.crtime ?? null, outcome: { kind: 'ok', crtime: r.crtime ?? null, performanceKept: !!r.performanceKept, draftGone } })
      } else patch(rid, { outcome: { kind: 'none' } })
    } catch (e) {
      patch(rid, { outcome: failureOf(e) })
    } finally {
      patch(rid, { busy: null })
    }
  }

  // [다시 쓰기] — 마무리(유형·Owners·성과)만 다시 쓴다. DB 가 답했는데 쓸 문서가 없으면 partial 그대로.
  async function finish(rid) {
    const it = find(rid)
    if (!it || it.busy) return
    patch(rid, { busy: 'finish', outcome: null })
    try {
      const r = (await api.finishDeploy(rid)).data.data
      if (r.result === 'ok') {
        forgetPending(rid)
        patch(rid, { result: 'ok', outcome: { kind: 'ok', crtime: r.crtime ?? null, performanceKept: false, draftGone: false } })
      } else patch(rid, { outcome: { kind: 'stillPartial' } })
    } catch (e) {
      patch(rid, { outcome: failureOf(e) })
    } finally {
      patch(rid, { busy: null })
    }
  }

  // [목록에서 빼기] — 서버 기록에 뺀 때만 남는다(결과는 그대로).
  async function dismiss(rid) {
    const it = find(rid)
    if (!it || it.busy) return
    patch(rid, { busy: 'dismiss', outcome: null })
    try {
      await api.dismissDeploy(rid)
      forgetPending(rid)
      items.value = items.value.filter((i) => i.requestId !== rid)
    } catch (e) {
      patch(rid, { busy: null, outcome: failureOf(e) })
    }
  }

  // 처음 쓸 때와 내 정보(쓰기 권한)를 읽은 뒤, 저장 창의 배포가 끝나거나 창이 닫히면 다시 받는다
  watch(() => editor.me?.canWrite, () => { refresh() }, { immediate: true })
  watch(() => flow.stage, (st, prev) => { if (prev && prev !== st && (st === null || ENDED.includes(st))) refresh() })

  return { items, failed, loading, count, refresh, verify, finish, dismiss }
})
