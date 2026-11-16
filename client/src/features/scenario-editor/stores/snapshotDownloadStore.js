// 스냅샷 받기(P3 설계 §4.6) — 목록에서 고른 줄을 한 장(PNG)이나 여러 장(ZIP)으로 내려받는다.
// - 서버에 다운로드 API 는 없다. 그림 API 로 한 장씩 차례로 받아 브라우저에서 묶는다(큰 화면의 그림 기억과 따로다 — 본 그림은 브라우저 HTTP 캐시가 바로 준다).
// - 시작할 때의 설비·날짜·고른 줄로 끝까지 간다. 받는 사이 화면의 설비·날짜·고른 줄이 바뀌어도 섞이지 않는다(DC-085).
// - 받지 못한 장은 건너뛰고 나머지를 저장한 뒤 못 받은 것을 창에 남긴다(DC-037). 취소하면 아무것도 저장하지 않는다.
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { scenarioEditorApi as api, blobError } from '../api'
import { t, errorMessage } from '../messages'
import { useSnapshotStore } from './snapshotStore'
import { useEditorStore } from './editorStore'
import { downloadLimit, runDownload, packDownload, drawCircle, saveBlob } from '../editor/snapshotDownload'

// status: idle · running(받는 중) · done(끝났는데 못 받은 것이 있어 창이 남아 있다). saved = { name, count } 또는 null(저장한 것 없음)
const idleJob = () => ({ status: 'idle', done: 0, total: 0, failed: [], saved: null })

export const useSnapshotDownloadStore = defineStore('scenarioEditorSnapshotDownload', () => {
  const snap = useSnapshotStore()
  const editor = useEditorStore()
  // 통째로 갈아 끼운다(못 받은 것의 줄을 깊은 반응형으로 감싸지 않는다)
  const job = shallowRef(idleJob())
  let controller = null

  async function reasonOf(e) {
    if (e?.code === 'CIRCLE_FAILED') return t('SEW_SNAP_DL_CIRCLE_FAILED')
    return errorMessage(await blobError(e))
  }

  // withCircle = "좌표 포함"
  async function start(withCircle) {
    if (job.value.status === 'running') return
    const items = snap.pickedItems.slice()
    if (!items.length) return
    const limit = downloadLimit(editor.me)
    if (items.length > limit) { snap.say(t('SEW_SNAP_DL_LIMIT', { max: limit, n: items.length })); return }
    const [eqpId, date] = [snap.eqpId, snap.date]
    const own = new AbortController()
    controller = own
    const total = items.length
    job.value = { status: 'running', done: 0, total, failed: [], saved: null }
    const canceled = () => { job.value = idleJob(); snap.say(t('SEW_SNAP_DL_CANCELED')) }
    try {
      const out = await runDownload({
        eqpId, date, items, withCircle, signal: own.signal, reasonOf, drawCircle,
        fetchBlob: async (fileName, signal) => (await api.snapshotImage(eqpId, fileName, signal)).data,
        onProgress: (done) => { job.value = { ...job.value, done } }
      })
      if (out.canceled) { canceled(); return }
      const packed = await packDownload({ eqpId, date, requested: total, files: out.files, withCircle })
      if (own.signal.aborted) { canceled(); return } // 묶는 사이에 취소했다
      if (packed) saveBlob(packed.blob, packed.name)
      if (!out.failed.length) {
        job.value = idleJob()
        snap.say(t('SEW_SNAP_DL_DONE', { n: out.files.length }))
        return
      }
      job.value = { status: 'done', done: total, total, failed: out.failed, saved: packed ? { name: packed.name, count: out.files.length } : null }
    } catch {
      // 묶거나 저장하다 실패했다(메모리 등) — 창이 "받는 중" 에 멈추지 않게 끝내고 알린다
      job.value = idleJob()
      snap.say(t('SEW_SNAP_DL_FAILED'))
    }
  }

  function cancel() {
    if (job.value.status === 'running') controller?.abort()
  }
  function close() {
    if (job.value.status !== 'running') job.value = idleJob()
  }

  return { job, start, cancel, close }
})
