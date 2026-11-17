// Vision·OCR 시험의 상태와 서버 호출 (P4 설계 §4.2·§4.3·§4.5). 시험은 스텝·초안을 바꾸지 않는다.
// - 그림은 브라우저가 준비한다: 시험할 화면(기준 화면 또는 지금 떠 있는 스냅샷)에서 검색 영역을 그림 안쪽으로 잘라 PNG 로,
//   찾을 그림은 원래 바이트 그대로(PNG 가 아닐 때만 다시 만든다).
// - 늦게 온 답은 버린다(요청 번호). 시험 입력 키가 바뀌면 결과를 지우고 요청을 끊고, 값만 바뀌면 stale 로 표시한다(sync).
//   (서버는 끊긴 요청의 판정 호출을 끝까지 두고 그동안 내 자리를 쥔다 — 바로 다시 누르면 "다른 시험이 돌고 있습니다" 가 나올 수 있다.)
// - [시험] 을 누르면 큰 화면을 시험한 화면의 모드로 바꾼다. 결과(run)는 큰 화면의 겹침(TestLayer)도 읽는다.
import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { scenarioEditorApi as api } from '../api'
import { loadBlob, bitmapOf } from '../editor/images'
import { cropPng } from '../editor/crop'
import { acceptOf, blockReason, cropOf, tooSmall, toScreen, clickOf, visionVerdict, ocrMeta, testKey, valueKey, ocrLines, confidenceOf } from '../editor/visionTest'
import { t, errorMessage } from '../messages'
import { useSnapshotStore } from './snapshotStore'

const IDLE = Object.freeze({ status: 'idle' })
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // 판정 서버가 받는 요청 한도 — 넘으면 올리지 않는다
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const stop = (key) => Object.assign(new Error(key), { testMessage: t(key) })

async function isPng(blob) {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  return head.length === 8 && PNG_HEAD.every((b, i) => head[i] === b)
}

export const useVisionTestStore = defineStore('scenarioEditorVisionTest', () => {
  const snap = useSnapshotStore()
  const screen = ref('base') // 사용자가 고른 시험할 화면: 'base' | 'snapshot'
  const acceptText = ref('') // 시험 정확도 칸
  const acceptTouched = ref(false)
  const acceptUid = ref(null)
  const run = shallowRef(IDLE)
  // 시험 줄이 보이는 스텝의 영역 — 큰 화면이 스냅샷 위에 그릴 때 쓴다(결과와 따로, 시험 줄이 알린다)
  const target = shallowRef(null)
  let seq = 0
  let controller = null

  function setScreen(v) { if (v === 'base' || v === 'snapshot') screen.value = v }
  // 지금의 시험할 화면. 스냅샷을 골랐는데 떠 있는 것이 없으면 snapshot 이 null 이다([시험] 이 꺼진다)
  function screenNow() {
    if (screen.value !== 'snapshot') return { kind: 'base' }
    const shown = snap.shownImage()
    return { kind: 'snapshot', snapshot: shown ? { eqpId: shown.eqpId, fileName: shown.fileName } : null }
  }

  // 넣은 값을 돌려준다 — 시험 줄이 사라질 때 제가 넣은 것일 때만 비우려고(새 시험 줄이 먼저 붙고 앞 시험 줄이 나중에 사라진다)
  function setTarget(input) { target.value = input?.area ? { kind: input.kind, area: input.area } : null; return target.value }

  function setAccept(text) { acceptText.value = String(text ?? ''); acceptTouched.value = true }
  // 패널의 정확도 값을 따라간다 — 시험 칸을 손댄 뒤에는 그대로 두고, 스텝이 바뀌면 다시 패널 값으로.
  // uid = 그 스텝을 가리키는 글(시험 줄이 시나리오·판까지 넣어 준다 — 스텝 uid 는 시나리오마다 s0, s1… 로 같다)
  // 두 자리로 보이되 더 긴 값(0.875)은 줄이지 않는다 — 줄이면 저장된 값과 다른 값으로 시험한다
  const acceptShown = (v) => (Number(v.toFixed(2)) === v ? v.toFixed(2) : String(v))
  function syncAccept(panelAccept, uid) {
    if (uid !== acceptUid.value) { acceptUid.value = uid; acceptTouched.value = false }
    if (acceptTouched.value) return
    acceptText.value = typeof panelAccept === 'number' && Number.isFinite(panelAccept) ? acceptShown(panelAccept) : ''
  }

  function cancel() {
    seq += 1
    if (controller) controller.abort()
    controller = null
  }
  function close() { cancel(); run.value = IDLE }

  // 시험 줄이 지금의 키·값 키를 알린다: 키가 다르면 지우고, 값만 다르면 stale
  function sync(key, vkey) {
    const s = run.value
    if (s.status === 'idle') return
    if (s.key !== key) { close(); return }
    const stale = s.valueKey !== vkey
    if (s.status !== 'running' && !!s.stale !== stale) run.value = { ...s, stale }
    else if (s.status === 'running') s.liveValueKey = vkey
  }
  function pick(i) {
    const s = run.value
    if (s.status === 'done' && s.results && i >= 0 && i < s.results.length) run.value = { ...s, picked: i }
  }

  async function prepare(input, scr) {
    let sourceBlob
    let trainBlob = null
    try {
      sourceBlob = scr.kind === 'snapshot' ? snap.shownImage()?.blob : await loadBlob(input.baseUrl)
      if (!sourceBlob) throw new Error('no screen image')
      if (input.kind === 'image') trainBlob = await loadBlob(input.trainUrl)
    } catch { throw stop('SEW_TEST_FAIL_IMAGE') }
    let bitmap
    let train = null
    try {
      bitmap = await bitmapOf(sourceBlob)
      if (trainBlob) {
        const tb = await bitmapOf(trainBlob)
        train = { w: tb.width, h: tb.height }
        if (!(await isPng(trainBlob))) trainBlob = await cropPng(tb, { x: 0, y: 0, w: tb.width, h: tb.height })
      }
    } catch { throw stop('SEW_TEST_FAIL_IMAGE') }
    const size = { w: bitmap.width, h: bitmap.height }
    const crop = cropOf(input.area, size)
    if (!crop) throw stop('SEW_TEST_FAIL_OUTSIDE')
    if (train && tooSmall(crop, train)) throw stop('SEW_TEST_FAIL_SMALL')
    const source = await cropPng(bitmap, crop)
    if (source.size + (trainBlob ? trainBlob.size : 0) > MAX_UPLOAD_BYTES) throw stop('SEW_ERR_VISION_TOO_LARGE')
    return { source, trainBlob, train, crop, size }
  }

  // input = editor/visionTest 의 시험 입력. 시작했으면 true(끝날 때까지 기다린다), [시험] 이 꺼진 상태면 false.
  async function start(input, { about = null } = {}) {
    const scr = screenNow()
    const accept = input?.kind === 'image' ? acceptOf(acceptText.value) : null
    if (blockReason(input, { screen: scr, accept, running: run.value.status === 'running' })) return false
    cancel()
    const id = seq
    const mine = new AbortController()
    controller = mine
    const head = { kind: input.kind, key: testKey(input, scr), valueKey: valueKey(input, accept), screen: scr.kind }
    run.value = { status: 'running', ...head, startedAt: Date.now() }
    if (scr.kind === 'snapshot') snap.showSnapshot()
    else snap.showStep()
    const finish = (state) => {
      if (id !== seq) return
      const live = run.value.liveValueKey
      run.value = { ...head, ...state, stale: state.status === 'done' && live !== undefined && live !== head.valueKey }
    }
    try {
      const p = await prepare(input, scr)
      if (id !== seq) return true
      const fd = new FormData()
      const meta = input.kind === 'image' ? { accept } : ocrMeta(input)
      fd.append('meta', JSON.stringify(about ? { ...meta, about } : meta))
      fd.append('source', p.source, 'source.png')
      if (p.trainBlob) fd.append('train', p.trainBlob, 'train.png')
      const res = await (input.kind === 'image' ? api.visionTest(fd, mine.signal) : api.ocrTest(fd, mine.signal))
      const data = res.data.data
      if (input.kind === 'image') {
        const results = toScreen(data.results, p.crop)
        finish({ status: 'done', results, train: p.train, click: clickOf(input, results[0]), verdict: visionVerdict(input, results.length), crop: p.crop, size: p.size, ms: data.ms, picked: 0 })
      } else {
        finish({ status: 'done', accepted: data.accepted === true, lines: ocrLines(data.found), confidence: confidenceOf(data.confidence), numeric: input.ocr.op >= 5, noSuffix: !input.ocr.multi, ms: data.ms })
      }
    } catch (e) {
      finish({ status: 'error', message: e?.testMessage ?? errorMessage(e) })
    }
    return true
  }

  return { screen, acceptText, acceptTouched, run, target, setTarget, setScreen, screenNow, setAccept, syncAccept, start, close, sync, pick }
})
