// 스냅샷 보기(P3 설계 §4.1~§4.3) — 왼쪽 패널(설비·날짜·하루 목록)과 큰 화면 스냅샷 모드의 상태.
// - 목록·그림 응답은 마지막 요청만 반영한다(DC-034·DC-077). 설비·날짜가 바뀌면 요청을 보낼 때 바로 고른 스냅샷·그림을 비운다(DC-035).
// - 그림은 Blob 으로 받아 object URL 로 띄운다 — 실패 이유(code)를 알 수 있고, 고른 것의 앞뒤 한 장을 미리 받아 둔다.
// - 펼침·접힘과 마지막 설비는 브라우저에 기억한다. 접혀 있으면 서버를 부르지 않는다.
// - 설비마다 스냅샷 유무(가장 늦은 날짜)는 설비 고르기 칸에 들어갈 때 뒤에서 나눠 받는다 — 패널을 펴기만 해서는 받지 않고, 설비 목록·고르기를 기다리게 하지 않는다.
// - 메모(P3-C): 줄의 메모는 하루 목록이 준다. 쓰기·고치기·지우기 뒤에는 그 줄만 바꾼 새 배열로 갈아 끼운다. 화면이 본 글을 함께 보내
//   그 사이 남이 바꿨으면(409) 덮어쓰지 않고 지금 값을 보인다. 갈 줄·고른 줄이 거른 목록에 없게 되면 거르기를 '전체' 로 돌린다.
// - 여러 줄 고르기(P3-D): 고른 줄 집합(picked)은 늘 큰 화면에 뜬 줄(selectedName)을 포함한다. 그냥 고르기·이동은 그 줄 하나,
//   Ctrl 은 더하기·빼기, Shift 는 기준 줄부터의 범위. 거른 목록에 없는 줄은 고른 것에서 뺀다(받을 대상 = 화면에 보이는 고른 줄).
import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { scenarioEditorApi as api, blobError } from '../api'
import { t, errorCode, errorMessage } from '../messages'
import { safeStorage } from '../composables/useSafeStorage'
import { FILTERS, filterItems, stepName, nextMatch, isTag, hasMemo, rangeNames, nearestName } from '../editor/snapshotList'
import { isDate, addDays, clampDate, laterOf } from '../editor/snapshotDates'

const KEY = 'se-snapshot'
const IMAGE_KEEP = 6 // 기억해 두는 그림 수(고른 것 + 앞뒤 + 방금 본 것)
const NOTICE_MS = 3000
const PRESENCE_STALE_MS = 5 * 60000 // 이보다 오래된 유무 표시는 설비 고르기에 들어갈 때 다시 받는다(서버는 10분 기억한다). 실패한 뒤에도 이만큼은 다시 청하지 않는다

function readSaved() {
  try {
    const v = JSON.parse(safeStorage.get(KEY) || 'null')
    if (!v || typeof v !== 'object') return { open: false, eqpId: null }
    return { open: v.open === true, eqpId: typeof v.eqpId === 'string' && v.eqpId ? v.eqpId : null }
  } catch {
    return { open: false, eqpId: null }
  }
}

// memoFailed = 서버가 메모를 읽지 못했다(목록은 메모 없이 왔다)
const emptyList = (status) => ({ status, items: [], truncated: false, memoFailed: false, error: '' })
const idleMemoList = () => ({ status: 'idle', items: [], truncated: false, error: '' })
const idleImage = () => ({ name: null, status: 'idle', url: null, code: null, error: '' })
const idleCalendar = () => ({ status: 'idle', days: null, truncated: false })
// status: idle(받기 전) · loading · ready · error · off(서버가 꺼 둠). latest = Map(설비 ID → 가장 늦은 표시 날짜), 스냅샷이 있는 설비만
const idlePresence = () => ({ status: 'idle', latest: new Map(), checked: 0, total: 0 })

export const useSnapshotStore = defineStore('scenarioEditorSnapshot', () => {
  const mode = ref('step') // 큰 화면: 'step'(스텝 그림) | 'snapshot'
  const open = ref(false) // 왼쪽 패널 펼침
  // 통째로 갈아 끼운다 — 설비 수만 대를 깊은 반응형으로 감싸면 설비 찾기에서 칠 때마다 느리다(10만 대 130~220ms → 5~22ms)
  const equipment = shallowRef({ status: 'idle', items: [], error: '' })
  // 통째로 갈아 끼운다(Map 은 받는 동안 같은 것에 더하고 감싼 값만 새로 낸다)
  const presence = shallowRef(idlePresence())
  const eqpId = ref(null)
  const range = ref(null) // { latest, today, oldest } — 표시 날짜
  const date = ref(null)
  // 통째로 갈아 끼우기만 한다 — 깊은 반응형으로 감싸면 5만 줄에서 고르기·이동이 줄마다 프록시를 만든다
  const list = shallowRef(emptyList('idle'))
  const filter = ref('all')
  const selectedName = ref(null)
  // 고른 줄(파일 이름) — 통째로 갈아 끼운다. 하나를 골랐으면 그 줄 하나다
  const picked = shallowRef(new Set())
  const calendar = ref(idleCalendar())
  // 메모 목록 창 — 통째로 갈아 끼운다
  const memoList = shallowRef(idleMemoList())
  const image = ref(idleImage())
  const notice = ref('')

  const shown = computed(() => filterItems(list.value.items, filter.value))
  const selected = computed(() => (selectedName.value ? list.value.items.find((i) => i.fileName === selectedName.value) ?? null : null))
  const position = computed(() => (selectedName.value ? shown.value.findIndex((i) => i.fileName === selectedName.value) : -1))
  // 고른 줄 — 거른 목록의 순서로(받기의 대상)
  const pickedItems = computed(() => (picked.value.size ? shown.value.filter((i) => picked.value.has(i.fileName)) : []))
  const minDate = computed(() => range.value?.oldest ?? null)
  // 설비 시계가 앞서 가장 늦은 날이 오늘보다 뒤일 수 있다
  const maxDate = computed(() => (range.value ? laterOf(range.value.today, range.value.latest) : null))

  let pendingEqp = null // 기억해 둔 설비 — 설비 목록을 받은 뒤에 되살린다
  let anchor = null // 범위 고르기(Shift)의 기준 줄
  let listSeq = 0
  let calSeq = 0
  let noticeTimer = null

  const persist = () => safeStorage.set(KEY, JSON.stringify({ open: open.value, eqpId: eqpId.value ?? pendingEqp ?? null }))

  // ── 그림: 기억(이름 → { url }, 덜 쓴 것이 앞)과 진행 중 요청 ──
  const cache = new Map()
  const inflight = new Map()
  const touch = (name) => { const v = cache.get(name); cache.delete(name); cache.set(name, v) }
  // 고른 그림은 고를 때 맨 뒤로 가고 그 뒤에 더해지는 것은 이웃 둘뿐이라 넘쳐도 놓이지 않는다.
  // 받기(P3-D)는 이 기억을 쓰지 않는다 — 그림 API 를 따로 불러 Blob 으로 든다(stores/snapshotDownloadStore.js).
  function evict() {
    for (const name of [...cache.keys()]) {
      if (cache.size <= IMAGE_KEEP) break
      URL.revokeObjectURL(cache.get(name).url)
      cache.delete(name)
    }
  }
  function resetImages() {
    for (const f of inflight.values()) f.controller.abort()
    inflight.clear()
    for (const v of cache.values()) URL.revokeObjectURL(v.url)
    cache.clear()
  }
  function fetchImage(name) {
    if (cache.has(name)) { touch(name); return Promise.resolve(cache.get(name)) }
    if (inflight.has(name)) return inflight.get(name).promise
    const controller = new AbortController()
    const owner = eqpId.value
    const promise = api.snapshotImage(owner, name, controller.signal)
      .then((res) => {
        if (eqpId.value !== owner) throw new Error('equipment changed') // 설비가 바뀐 뒤에 온 그림은 기억하지 않는다
        cache.set(name, { url: URL.createObjectURL(res.data) })
        evict()
        return cache.get(name)
      })
      .finally(() => { if (inflight.get(name)?.controller === controller) inflight.delete(name) })
    inflight.set(name, { controller, promise })
    return promise
  }
  const neighbors = (name) => [stepName(shown.value, name, -1), stepName(shown.value, name, 1)].filter(Boolean)
  function prefetch(name) {
    for (const n of neighbors(name)) fetchImage(n).catch(() => { /* 고를 때 다시 받는다 */ })
  }
  async function showImage(name) {
    // 빠르게 넘길 때: 지금 것과 이웃이 아닌 진행 중 요청은 끊는다
    const keep = new Set([name, ...neighbors(name)])
    for (const [n, f] of [...inflight]) if (!keep.has(n)) { f.controller.abort(); inflight.delete(n) }
    const hit = cache.get(name)
    if (hit) {
      touch(name)
      // 이미 떠 있는 그림이면 상태를 갈지 않는다(같은 줄을 다시 고름)
      if (!(image.value.name === name && image.value.status === 'ready' && image.value.url === hit.url)) {
        image.value = { name, status: 'ready', url: hit.url, code: null, error: '' }
      }
      prefetch(name)
      return
    }
    image.value = { name, status: 'loading', url: null, code: null, error: '' }
    try {
      const got = await fetchImage(name)
      if (selectedName.value !== name) return // 그 사이 다른 것을 골랐다(DC-034)
      image.value = { name, status: 'ready', url: got.url, code: null, error: '' }
      prefetch(name)
    } catch (e) {
      if (selectedName.value !== name) return
      const err = await blobError(e)
      if (selectedName.value !== name) return
      image.value = { name, status: 'error', url: null, code: errorCode(err), error: errorMessage(err) }
    }
  }

  function clearSelection() {
    selectedName.value = null
    image.value = idleImage()
    picked.value = new Set()
    anchor = null
  }
  // 거른 목록에 없는 줄은 고른 것에서 뺀다(뜬 줄은 거른 목록에 있다고 본다 — 없으면 부르는 쪽이 먼저 비운다)
  function prunePicked() {
    if (!picked.value.size) return
    const kept = shown.value.filter((i) => picked.value.has(i.fileName)).map((i) => i.fileName)
    if (kept.length !== picked.value.size) picked.value = new Set(kept)
    if (anchor && !picked.value.has(anchor)) anchor = selectedName.value
  }
  const sameRange = (d) => ({ latest: d.latest ?? null, today: d.today ?? null, oldest: d.oldest ?? null })

  // ── 목록 ──
  // seq = 이 요청의 번호(마지막 요청만 반영). keep = 새 목록에 있으면 지킬 선택, keepItems = 받는 동안 앞 목록을 그대로 둔다(새로 고침).
  async function loadList(seq, { selectLast = false, keep = null, keepItems = false } = {}) {
    const id = eqpId.value
    const day = date.value
    list.value = keepItems ? { ...list.value, status: 'loading', error: '' } : emptyList('loading')
    try {
      const r = (await api.snapshots(id, day)).data.data
      if (seq !== listSeq) return
      // 답에 적힌 설비·날짜가 요청과 다르면 쓰지 않는다(DC-077)
      if (r?.eqpId !== id || r?.date !== day) {
        clearSelection()
        list.value = { ...emptyList('error'), error: t('SEW_SNAP_LIST_FAILED') }
        return
      }
      list.value = { status: 'ready', items: Array.isArray(r.items) ? r.items : [], truncated: !!r.truncated, memoFailed: !!r.memoFailed, error: '' }
      if (keep) {
        if (!list.value.items.some((i) => i.fileName === keep)) clearSelection()
        else {
          // 지킨 줄이 거른 목록에 없게 됐다('메모' 거르기인데 그 사이 메모가 지워짐) — 고른 줄이 목록에서 사라지지 않게
          if (position.value < 0) filter.value = 'all'
          prunePicked() // 새 목록에 없는 줄은 고른 것에서 뺀다
        }
      } else if (selectLast && shown.value.length) {
        select(shown.value[shown.value.length - 1].fileName)
      }
    } catch (e) {
      if (seq !== listSeq) return
      clearSelection()
      list.value = { ...emptyList('error'), error: errorMessage(e) }
    }
  }

  // 설비를 고른다 — 가장 늦은 날을 열고(select) 마지막 줄을 고른다. 되살릴 때는 고르지 않는다.
  async function pickEquipment(id, { select: pick = true } = {}) {
    const seq = ++listSeq
    calSeq++
    resetImages()
    eqpId.value = id
    pendingEqp = null
    persist()
    range.value = null
    date.value = null
    calendar.value = idleCalendar()
    clearSelection()
    list.value = emptyList('loading')
    try {
      const d = (await api.snapshotDays(id)).data.data
      if (seq !== listSeq) return
      range.value = sameRange(d)
      if (!d.latest) { list.value = emptyList('ready'); return }
      date.value = d.latest
      await loadList(seq, { selectLast: pick })
    } catch (e) {
      if (seq !== listSeq) return
      list.value = { ...emptyList('error'), error: errorMessage(e) }
    }
  }

  async function setDate(next) {
    if (!eqpId.value || !isDate(next) || !minDate.value || !maxDate.value) return
    const day = clampDate(next, minDate.value, maxDate.value)
    if (day === date.value) return
    date.value = day
    clearSelection()
    await loadList(++listSeq)
  }
  const moveDate = (delta) => (date.value ? setDate(addDays(date.value, delta)) : Promise.resolve())

  // 같은 설비·날짜를 다시 받는다. 고른 줄이 새 목록에 있으면 지킨다.
  async function refresh() {
    if (!eqpId.value) return
    const seq = ++listSeq
    calSeq++
    calendar.value = idleCalendar() // 날짜별 개수는 달력을 다시 열 때 받는다
    // 있는 날을 기다리는 동안에도 받는 중으로 보인다(저장소가 응답하지 않으면 10초쯤 걸린다). 앞 목록은 그대로 둔다
    list.value = { ...list.value, status: 'loading', error: '' }
    const id = eqpId.value
    let sameDay = !!date.value // 같은 날을 다시 받을 때만 앞 목록·선택을 지킨다
    try {
      const d = (await api.snapshotDays(id)).data.data
      if (seq !== listSeq) return
      range.value = sameRange(d)
      if (!date.value) {
        if (!d.latest) { list.value = emptyList('ready'); return }
        date.value = d.latest
      } else if (minDate.value && maxDate.value) {
        const day = clampDate(date.value, minDate.value, maxDate.value) // 날이 지나 보관 기간 밖이 됐을 수 있다
        if (day !== date.value) { date.value = day; clearSelection(); sameDay = false }
      }
      await loadList(seq, { keep: sameDay ? selectedName.value : null, keepItems: sameDay })
    } catch (e) {
      if (seq !== listSeq) return
      clearSelection()
      list.value = { ...emptyList('error'), error: errorMessage(e) }
    }
  }

  function setFilter(next) {
    if (!FILTERS.includes(next)) return
    filter.value = next
    if (selectedName.value && position.value < 0) clearSelection()
    else prunePicked()
  }

  // 큰 화면에 띄운다(고른 줄 집합은 건드리지 않는다)
  function show(name) {
    selectedName.value = name
    mode.value = 'snapshot'
    showImage(name)
  }
  // 그 줄 하나를 고른다
  function select(name) {
    if (!list.value.items.some((i) => i.fileName === name)) return
    picked.value = new Set([name])
    anchor = name
    show(name)
  }
  const inShown = (name) => shown.value.some((i) => i.fileName === name)
  // 더하기·빼기(Ctrl) — 더한 줄이 뜬다. 뜬 줄을 빼면 가장 가까운 남은 줄이 뜬다. 하나만 남으면 빼지 않는다.
  function togglePick(name) {
    if (!inShown(name)) return
    if (!selectedName.value) { select(name); return }
    const next = new Set(picked.value)
    if (!next.has(name)) {
      next.add(name)
      picked.value = next
      anchor = name
      show(name)
      return
    }
    if (next.size === 1) return
    next.delete(name)
    picked.value = next
    if (name === selectedName.value) {
      const to = nearestName(shown.value, next, name)
      anchor = to
      show(to)
    } else if (name === anchor) {
      anchor = selectedName.value
    }
  }
  // 범위(Shift) — 기준 줄부터 그 줄까지(지금 거른 목록 안에서). 앞서 고른 것은 갈아 치우고, 기준 줄은 그대로 둔다.
  function pickRange(name) {
    if (!inShown(name)) return
    const from = anchor && inShown(anchor) ? anchor : selectedName.value
    const names = rangeNames(shown.value, from, name)
    picked.value = new Set(names)
    anchor = from && names.includes(from) ? from : name
    show(name)
  }
  // Shift+↑↓ — 뜬 줄을 한 줄 옮기며 범위를 늘리거나 줄인다
  function moveRange(delta) {
    const next = stepName(shown.value, selectedName.value, delta)
    if (next) pickRange(next)
  }
  function move(delta) {
    const next = stepName(shown.value, selectedName.value, delta)
    if (next) select(next)
  }
  // 그 날 목록(거르기와 상관없이 전체)에서 다음(앞) 태그·메모 — 끝에서 처음으로 돌아간다(DC-076).
  // 갈 줄이 지금 거른 목록에 없으면 거르기를 '전체' 로 돌린다(고른 줄이 목록에 안 보이는 상태를 만들지 않는다).
  function jump(dir, pred, noneKey) {
    const next = nextMatch(list.value.items, selectedName.value, dir, pred)
    if (!next) { say(t(noneKey)); return }
    if (!shown.value.some((i) => i.fileName === next)) filter.value = 'all'
    select(next)
  }
  const moveTag = (dir) => jump(dir, isTag, 'SEW_SNAP_NO_TAG')
  const moveMemo = (dir) => jump(dir, hasMemo, 'SEW_SNAP_NO_MEMO')

  // ── 메모 ──
  // 그 줄의 메모를 바꾼다(줄 하나만 새로 만든 새 배열). 그 사이 설비·날짜가 바뀌었으면(다른 목록) 아무것도 하지 않는다.
  function patchMemo(id, day, name, memo) {
    if (eqpId.value !== id || date.value !== day) return
    const i = list.value.items.findIndex((x) => x.fileName === name)
    if (i < 0) return
    const items = list.value.items.slice()
    items[i] = { ...items[i], memo }
    list.value = { ...list.value, items }
    // '메모' 거르기에서 고른 줄의 메모를 지웠다 — 고른 줄이 목록에서 사라지지 않게
    if (selectedName.value && position.value < 0) filter.value = 'all'
    else prunePicked() // 뜨지 않은 고른 줄이 거른 목록에서 빠졌으면 고른 것에서도 뺀다
    // 목록을 다시 받는 중이었다 — 먼저 떠난 요청의 답(이 메모가 없던 때의 목록)이 방금 바꾼 줄을 덮지 않게 다시 받는다
    if (list.value.status === 'loading') refresh()
  }
  const currentOf = (e) => e?.response?.data?.details?.current ?? null
  // 결과: { ok } · { conflict, current }(그 사이 바뀜 — 줄은 지금 값으로 바꿨다) · { gone }(지우려는데 이미 없음) · { error, code }
  async function saveMemo(name, text) {
    const item = list.value.items.find((i) => i.fileName === name)
    if (!item) return { error: t('SEW_SNAP_MEMO_SNAPSHOT_GONE'), code: 'SNAPSHOT_NOT_FOUND' }
    const [id, day] = [eqpId.value, date.value]
    try {
      const r = (await api.saveMemo(id, name, text, item.memo ? item.memo.text : null)).data.data
      patchMemo(id, day, name, r?.memo ?? null)
      return { ok: true }
    } catch (e) {
      const code = errorCode(e)
      if (code !== 'MEMO_CONFLICT') return { error: errorMessage(e), code }
      const current = currentOf(e)
      patchMemo(id, day, name, current)
      return { conflict: true, current }
    }
  }
  async function removeMemo(name) {
    const item = list.value.items.find((i) => i.fileName === name)
    if (!item?.memo) return { gone: true }
    const [id, day] = [eqpId.value, date.value]
    try {
      const r = (await api.removeMemo(id, name, item.memo.text)).data.data
      patchMemo(id, day, name, r?.memo ?? null) // 같은 키의 옛 메모가 남아 있으면 그것이 온다
      return { ok: true }
    } catch (e) {
      const code = errorCode(e)
      if (code === 'MEMO_GONE') { patchMemo(id, day, name, null); return { gone: true } }
      if (code !== 'MEMO_CONFLICT') return { error: errorMessage(e), code }
      const current = currentOf(e)
      patchMemo(id, day, name, current)
      return { conflict: true, current }
    }
  }

  // ── 메모 목록 창 ──
  let memoSeq = 0
  async function loadMemoList() {
    const seq = ++memoSeq
    memoList.value = { ...memoList.value, status: 'loading', error: '' }
    try {
      const r = (await api.memos()).data.data
      if (seq !== memoSeq) return
      memoList.value = { status: 'ready', items: Array.isArray(r?.items) ? r.items : [], truncated: !!r?.truncated, error: '' }
    } catch (e) {
      if (seq !== memoSeq) return
      memoList.value = { status: 'error', items: [], truncated: false, error: errorMessage(e) }
    }
  }
  // 메모 목록에서 고른 메모의 스냅샷으로 간다 — 설비·날짜를 바꾸고 거르기를 '전체' 로 돌려 목록을 한 번 받아 그 줄을 고른다.
  // 목록에 없으면 알리고 다시 청하지 않는다(SE-016).
  async function goToMemo(m) {
    const seq = ++listSeq
    calSeq++
    resetImages()
    eqpId.value = m.eqpId
    pendingEqp = null
    persist()
    range.value = null
    date.value = m.date
    calendar.value = idleCalendar()
    clearSelection()
    filter.value = 'all'
    // 달력·날짜 이동의 범위는 따로 받는다(실패해도 목록은 보인다)
    const days = api.snapshotDays(m.eqpId).then((res) => { if (seq === listSeq) range.value = sameRange(res.data.data) }).catch(() => {})
    await loadList(seq)
    // 범위를 기다리지 않고 목록을 받자마자 고른다(기다리는 사이 사용자가 고른 줄을 덮지 않게)
    if (seq === listSeq && list.value.status === 'ready') {
      if (list.value.items.some((i) => i.fileName === m.fileName)) select(m.fileName)
      else { mode.value = 'snapshot'; say(t('SEW_SNAP_MEMO_SNAPSHOT_GONE')) } // 알림은 스냅샷 화면에 있다
    }
    await days
  }

  // 달력을 열 때 날짜별 개수를 받는다(설비를 바꾸거나 새로 고치기 전까지 한 번)
  async function openCalendar() {
    if (!eqpId.value || calendar.value.status === 'loading' || calendar.value.status === 'ready') return
    const seq = ++calSeq
    calendar.value = { status: 'loading', days: null, truncated: false }
    try {
      const d = (await api.snapshotDays(eqpId.value, true)).data.data
      if (seq !== calSeq) return
      calendar.value = { status: 'ready', days: d.days ?? {}, truncated: !!d.truncated }
    } catch {
      if (seq !== calSeq) return
      calendar.value = { status: 'error', days: null, truncated: false }
    }
  }

  // ── 설비마다 스냅샷 유무 ── 서버가 나눠 준다(next 를 after 로 이어 청한다). 실패해도 설비 고르기는 그대로 쓴다(표시만 빠진다).
  let presenceSeq = 0
  let presenceBusy = false
  let presenceAt = 0 // 마지막으로 받기를 끝낸 때(실패 포함)
  // quiet = 다시 받기 — 다 받을 때까지 앞의 값을 그대로 보인다
  async function loadPresence({ quiet = false } = {}) {
    const seq = ++presenceSeq
    const latest = new Map()
    presenceBusy = true
    const done = (value) => { presence.value = value; presenceBusy = false; presenceAt = Date.now() }
    if (!quiet) presence.value = { status: 'loading', latest, checked: 0, total: 0 }
    try {
      let after = ''
      for (;;) {
        const r = (await api.snapshotPresence(after)).data.data
        if (seq !== presenceSeq) return
        const total = Number.isFinite(r?.total) ? r.total : 0
        if (r?.enabled === false) { done({ status: 'off', latest: new Map(), checked: 0, total }); return }
        for (const [id, date] of Array.isArray(r?.items) ? r.items : []) latest.set(id, date)
        const checked = Number.isFinite(r?.checked) ? r.checked : 0
        const next = typeof r?.next === 'string' && r.next ? r.next : null
        if (!next) { done({ status: 'ready', latest, checked, total }); return }
        if (!(next > after)) throw new Error('presence cursor did not advance') // 끝없이 청하지 않는다
        if (!quiet) presence.value = { status: 'loading', latest, checked, total }
        after = next
      }
    } catch {
      if (seq !== presenceSeq) return
      done({ status: 'error', latest: new Map(), checked: 0, total: 0 })
    }
  }
  // 설비 고르기 칸에 들어갈 때 부른다 — 처음이면 받기 시작하고, 받은(실패한) 지 오래됐으면 다시 받는다. 서버가 꺼 두었으면 다시 청하지 않는다.
  function refreshPresence() {
    if (equipment.value.status !== 'ready' || presenceBusy) return
    const status = presence.value.status
    if (status === 'off') return
    if (status !== 'idle' && Date.now() - presenceAt < PRESENCE_STALE_MS) return
    loadPresence({ quiet: status === 'ready' })
  }
  // 받던 것을 버린다. 처음 받던 중이었으면 받기 전으로 돌린다(다시 받던 중이었으면 앞의 값은 남는다)
  function stopPresence() {
    presenceSeq++
    presenceBusy = false
    if (presence.value.status === 'loading') presence.value = idlePresence()
  }

  // ── 설비 목록·패널 ──
  async function loadEquipment() {
    equipment.value = { status: 'loading', items: equipment.value.items, error: '' }
    // 설비 목록이 바뀔 수 있으니 유무는 받기 전으로 — 설비 고르기 칸에 들어갈 때 다시 받는다
    stopPresence()
    presence.value = idlePresence()
    try {
      const data = (await api.equipment()).data.data
      equipment.value = { status: 'ready', items: Array.isArray(data?.items) ? data.items : [], error: '' }
    } catch (e) {
      equipment.value = { status: 'error', items: [], error: errorMessage(e) }
      return
    }
    // 기억해 둔 설비: 지금도 내 범위에 있으면 목록만 되살리고(고르지 않는다), 없으면 버린다
    if (!eqpId.value && pendingEqp) {
      const id = pendingEqp
      pendingEqp = null
      if (equipment.value.items.some((e) => e.eqpId === id)) await pickEquipment(id, { select: false })
      else persist()
    }
  }
  async function setOpen(next) {
    open.value = !!next
    persist()
    if (!open.value) stopPresence() // 접으면 서버를 부르지 않는다
    if (open.value && equipment.value.status === 'idle') await loadEquipment()
  }
  // 화면이 처음 뜰 때 한 번 — 접힌 채면 서버를 부르지 않는다
  let restored = false
  async function restore() {
    if (restored) return
    restored = true
    const saved = readSaved()
    open.value = saved.open
    pendingEqp = saved.eqpId
    if (open.value) await loadEquipment()
  }

  const showStep = () => { mode.value = 'step' }
  const showSnapshot = () => { mode.value = 'snapshot' }
  function say(text) {
    notice.value = text
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notice.value = '' }, NOTICE_MS)
  }

  return {
    mode, open, equipment, presence, eqpId, range, date, list, filter, selectedName, picked, calendar, image, notice, memoList,
    shown, selected, position, pickedItems, minDate, maxDate,
    restore, setOpen, loadEquipment, refreshPresence, pickEquipment, setDate, moveDate, refresh, setFilter, select, togglePick, pickRange, moveRange, move, moveTag, moveMemo, saveMemo, removeMemo, loadMemoList, goToMemo, openCalendar, showStep, showSnapshot, say
  }
})
