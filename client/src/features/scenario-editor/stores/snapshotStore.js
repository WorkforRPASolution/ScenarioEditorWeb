// 스냅샷 보기(P3 설계 §4.1~§4.3) — 왼쪽 패널(설비·날짜·하루 목록)과 큰 화면 스냅샷 모드의 상태.
// - 목록·그림 응답은 마지막 요청만 반영한다(DC-034·DC-077). 설비·날짜가 바뀌면 요청을 보낼 때 바로 고른 스냅샷·그림을 비운다(DC-035).
// - 그림은 Blob 으로 받아 object URL 로 띄운다 — 실패 이유(code)를 알 수 있고, 고른 것의 앞뒤 한 장을 미리 받아 둔다.
// - 펼침·접힘과 마지막 설비는 브라우저에 기억한다. 접혀 있으면 서버를 부르지 않는다.
// 메모(거르기·이동)는 P3-C, 여러 줄 고르기(다운로드)는 P3-D 에서 더한다.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { scenarioEditorApi as api, blobError } from '../api'
import { t, errorCode, errorMessage } from '../messages'
import { safeStorage } from '../composables/useSafeStorage'
import { FILTERS, filterItems, stepName, nextMatch, isTag } from '../editor/snapshotList'
import { isDate, addDays, clampDate, laterOf } from '../editor/snapshotDates'

const KEY = 'se-snapshot'
const IMAGE_KEEP = 6 // 기억해 두는 그림 수(고른 것 + 앞뒤 + 방금 본 것)
const NOTICE_MS = 3000

function readSaved() {
  try {
    const v = JSON.parse(safeStorage.get(KEY) || 'null')
    if (!v || typeof v !== 'object') return { open: false, eqpId: null }
    return { open: v.open === true, eqpId: typeof v.eqpId === 'string' && v.eqpId ? v.eqpId : null }
  } catch {
    return { open: false, eqpId: null }
  }
}

const emptyList = (status) => ({ status, items: [], truncated: false, error: '' })
const idleImage = () => ({ name: null, status: 'idle', url: null, code: null, error: '' })
const idleCalendar = () => ({ status: 'idle', days: null, truncated: false })

export const useSnapshotStore = defineStore('scenarioEditorSnapshot', () => {
  const mode = ref('step') // 큰 화면: 'step'(스텝 그림) | 'snapshot'
  const open = ref(false) // 왼쪽 패널 펼침
  const equipment = ref({ status: 'idle', items: [], error: '' })
  const eqpId = ref(null)
  const range = ref(null) // { latest, today, oldest } — 표시 날짜
  const date = ref(null)
  const list = ref(emptyList('idle'))
  const filter = ref('all')
  const selectedName = ref(null)
  const calendar = ref(idleCalendar())
  const image = ref(idleImage())
  const notice = ref('')

  const shown = computed(() => filterItems(list.value.items, filter.value))
  const selected = computed(() => (selectedName.value ? list.value.items.find((i) => i.fileName === selectedName.value) ?? null : null))
  const position = computed(() => (selectedName.value ? shown.value.findIndex((i) => i.fileName === selectedName.value) : -1))
  const minDate = computed(() => range.value?.oldest ?? null)
  // 설비 시계가 앞서 가장 늦은 날이 오늘보다 뒤일 수 있다
  const maxDate = computed(() => (range.value ? laterOf(range.value.today, range.value.latest) : null))

  let pendingEqp = null // 기억해 둔 설비 — 설비 목록을 받은 뒤에 되살린다
  let listSeq = 0
  let calSeq = 0
  let noticeTimer = null

  const persist = () => safeStorage.set(KEY, JSON.stringify({ open: open.value, eqpId: eqpId.value ?? pendingEqp ?? null }))

  // ── 그림: 기억(이름 → { url }, 덜 쓴 것이 앞)과 진행 중 요청 ──
  const cache = new Map()
  const inflight = new Map()
  const touch = (name) => { const v = cache.get(name); cache.delete(name); cache.set(name, v) }
  function evict() {
    for (const name of [...cache.keys()]) {
      if (cache.size <= IMAGE_KEEP) break
      if (name === image.value.name || name === selectedName.value) continue // 화면에 뜬 그림은 놓지 않는다
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
      image.value = { name, status: 'ready', url: hit.url, code: null, error: '' }
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
      list.value = { status: 'ready', items: Array.isArray(r.items) ? r.items : [], truncated: !!r.truncated, error: '' }
      if (keep) {
        if (!list.value.items.some((i) => i.fileName === keep)) clearSelection()
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
  }

  function select(name) {
    if (!list.value.items.some((i) => i.fileName === name)) return
    selectedName.value = name
    mode.value = 'snapshot'
    showImage(name)
  }
  function move(delta) {
    const next = stepName(shown.value, selectedName.value, delta)
    if (next) select(next)
  }
  // 그 날 목록에서 다음(앞) 태그 — 끝에서 처음으로 돌아간다(DC-076)
  function moveTag(dir) {
    const next = nextMatch(list.value.items, selectedName.value, dir, isTag)
    if (!next) { say(t('SEW_SNAP_NO_TAG')); return }
    select(next)
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

  // ── 설비 목록·패널 ──
  async function loadEquipment() {
    equipment.value = { status: 'loading', items: equipment.value.items, error: '' }
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
    mode, open, equipment, eqpId, range, date, list, filter, selectedName, calendar, image, notice,
    shown, selected, position, minDate, maxDate,
    restore, setOpen, loadEquipment, pickEquipment, setDate, moveDate, refresh, setFilter, select, move, moveTag, openCalendar, showStep, showSnapshot, say
  }
})
