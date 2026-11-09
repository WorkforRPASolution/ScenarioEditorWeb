<script setup>
// 원개발자(목업 renderSide·renderPop). 따로 패널 없이 창 작업본에서만 고치고 [성과 저장]이 다른 성과 칸과 한 요청으로 보낸다(DC-137).
// 찾기는 등록 사용자를 이름·아이디로(2자 이상, DC-140) — 결과 줄 = 이름·아이디·공정, 이미 넣은 사람은 꺼짐(SE-035).
// 고르면 기여도는 빈칸으로 넣고 그 칸에 초점. Esc·밖 누름은 찾기 목록만 닫는다. 빼기는 줄마다 보이는 ✕.
// 옛 데이터의 같은 사람 두 줄·등록 안 된 사람은 원개발자를 고치지 않으면 경고만(서버도 목록을 보낼 때만 본다).
import { ref, computed, inject, nextTick, onBeforeUnmount } from 'vue'
import { scenarioEditorApi as api } from '../../api'
import { t, LABELS, errorMessage } from '../../messages'
import { isIntText } from '../../editor/performanceRules'
import PerformanceErrors from './PerformanceErrors.vue'

defineOptions({ name: 'PerformanceDevelopers' })
const ctx = inject('sePerformanceCtx')
const L = LABELS.perf
const SEARCH_MIN = 2
const SEARCH_DELAY_MS = 250
const SEARCH_LIMIT = 20 // 서버 찾기 상한

const devs = computed(() => ctx.f.devs)
const pctOf = (d) => (isIntText(d.p) ? Number(String(d.p).trim()) : 0)
const sum = computed(() => devs.value.reduce((a, d) => a + pctOf(d), 0))
const counts = computed(() => devs.value.reduce((m, d) => m.set(d.id, (m.get(d.id) ?? 0) + 1), new Map()))
const firstIndex = (id) => devs.value.findIndex((d) => d.id === id)
const isLater = (d, i) => counts.value.get(d.id) > 1 && firstIndex(d.id) !== i
const unregistered = (d) => ctx.reg[d.id] === false
function warnOf(d, i) {
  if (ctx.devsChanged || !(isLater(d, i) || unregistered(d))) return ''
  return [isLater(d, i) && t('SEW_PERF_DEV_WARN_DUP'), unregistered(d) && t('SEW_PERF_DEV_WARN_UNREG'), t('SEW_PERF_DEV_WARN_KEEP')].filter(Boolean).join(' ')
}
const rowBad = (i) => ctx.hasErr(`devp:${i}`) || ctx.hasErr('devs')
const hasMsg = (d, i) => ctx.hasErr(`dev:${i}`) || ctx.hasErr(`devp:${i}`) || !!warnOf(d, i) || isLater(d, i)

async function remove(i) {
  ctx.removeDev(i)
  await nextTick()
  ctx.focus(devs.value.length ? `devdel:${Math.min(i, devs.value.length - 1)}` : 'search')
}
async function merge(i) {
  const j = ctx.mergeDev(i)
  await nextTick()
  ctx.focus(`devp:${j}`)
}

// 찾기
const q = ref('')
const state = ref('idle') // idle·short·loading·done·error
const open = ref(false)
const hits = ref([])
const failText = ref('')
const wrapEl = ref(null)
const inputEl = ref(null)
let timer = null
let seq = 0
const added = (u) => devs.value.some((d) => d.id === u.singleid)

function setOpen(v) {
  open.value = v
  if (v) document.addEventListener('mousedown', onDocDown, true)
  else document.removeEventListener('mousedown', onDocDown, true)
}
function closePop() { setOpen(false) }
function onDocDown(e) { if (!wrapEl.value?.contains(e.target)) closePop() }
onBeforeUnmount(() => { clearTimeout(timer); document.removeEventListener('mousedown', onDocDown, true) })

function onInput(v) {
  q.value = v
  clearTimeout(timer)
  const text = v.trim()
  const my = ++seq
  if (!text) { state.value = 'idle'; closePop(); return }
  if (text.length < SEARCH_MIN) { state.value = 'short'; setOpen(true); return }
  state.value = 'loading'
  setOpen(true)
  timer = setTimeout(async () => {
    try {
      const rows = (await api.searchUsers(text)).data.data
      if (my !== seq) return
      hits.value = Array.isArray(rows) ? rows : []
      state.value = 'done'
    } catch (e) {
      if (my !== seq) return
      failText.value = errorMessage(e)
      state.value = 'error'
    }
  }, SEARCH_DELAY_MS)
}
// 찾기 칸을 다시 누르면 지난 결과를 다시 연다
function reopen() { if (!open.value && q.value.trim().length >= SEARCH_MIN && state.value === 'done') setOpen(true) }

async function pick(u) {
  if (added(u)) return
  ctx.addDev(u)
  q.value = ''
  state.value = 'idle'
  closePop()
  await nextTick()
  ctx.focus(`devp:${devs.value.length - 1}`)
}

// Esc 는 찾기 목록만 닫는다(창까지 닫지 않게 여기서 멈춤), ↓·↑ 는 결과 사이를 옮긴다
function onKey(e) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closePop()
    inputEl.value?.focus()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const list = [...(wrapEl.value?.querySelectorAll('.hit:not([disabled])') ?? [])]
  if (!list.length) return
  e.preventDefault()
  const i = list.indexOf(document.activeElement)
  const n = e.key === 'ArrowDown' ? (i < 0 ? 0 : Math.min(list.length - 1, i + 1)) : i - 1
  if (n < 0) inputEl.value?.focus()
  else list[n].focus()
}

// 찾은 글자 강조
function parts(text, needle) {
  const s = String(text ?? '')
  const i = s.toLowerCase().indexOf(needle.trim().toLowerCase())
  if (!needle.trim() || i < 0) return [s, '', '']
  return [s.slice(0, i), s.slice(i, i + needle.trim().length), s.slice(i + needle.trim().length)]
}
</script>

<template>
  <div>
    <div class="se-pf-dv-h">
      <h4 id="se-pf-dv-h">{{ L.devs }}</h4>
      <span class="se-pf-stack" :class="{ over: sum > 100 }" aria-hidden="true">
        <i v-for="(d, i) in devs" :key="i" :style="{ width: `${Math.max(0, Math.min(100, pctOf(d)))}%` }" />
      </span>
      <span class="se-pf-sum" :class="{ bad: sum > 100 }" data-testid="se-perf-sum">{{ t('SEW_PERF_DEV_SUM', { n: sum }) }}</span>
    </div>
    <div ref="wrapEl" class="se-pf-srch" @keydown="onKey">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
      <input ref="inputEl" class="se-pp-inp" :value="q" :placeholder="t('SEW_PERF_SEARCH_PH')" :aria-label="L.search" autocomplete="off" :aria-expanded="String(open)"
        data-pf="search" @input="onInput($event.target.value)" @click="reopen">
      <div v-if="open" class="se-pf-pop" data-testid="se-perf-pop" :role="state === 'done' && hits.length ? 'listbox' : 'status'">
        <div v-if="state === 'short'" class="st">{{ t('SEW_PERF_SEARCH_SHORT') }}</div>
        <div v-else-if="state === 'loading'" class="st"><span class="se-pf-spin" aria-hidden="true" />{{ t('SEW_PERF_SEARCHING', { q: q.trim() }) }}</div>
        <div v-else-if="state === 'error'" class="st">{{ t('SEW_PERF_SEARCH_FAILED', { cause: failText }) }}</div>
        <div v-else-if="!hits.length" class="st"><b>{{ t('SEW_PERF_SEARCH_NONE', { q: q.trim() }) }}</b><br>{{ t('SEW_PERF_SEARCH_NONE_HELP') }}</div>
        <template v-else>
          <div class="st" style="padding: 4px 8px 2px">{{ t('SEW_PERF_SEARCH_COUNT', { n: hits.length }) }}</div>
          <button v-for="u in hits" :key="u.singleid" type="button" class="hit" role="option" :disabled="added(u)" :aria-disabled="String(added(u))"
            data-testid="se-perf-hit" @click="pick(u)">
            <span>
              <b>{{ parts(u.name, q)[0] }}<mark>{{ parts(u.name, q)[1] }}</mark>{{ parts(u.name, q)[2] }}</b>
              <span class="se-pf-id">{{ parts(u.singleid, q)[0] }}<mark>{{ parts(u.singleid, q)[1] }}</mark>{{ parts(u.singleid, q)[2] }}</span>
              <span class="who">{{ t('SEW_PERF_SEARCH_PROCESS', { process: u.process || '-' }) }}</span>
            </span>
            <span v-if="added(u)" class="se-pf-tag">{{ t('SEW_PERF_SEARCH_ADDED') }}</span>
          </button>
          <div v-if="hits.length >= SEARCH_LIMIT" class="st">{{ t('SEW_PERF_SEARCH_MORE') }}</div>
        </template>
      </div>
    </div>
    <div class="se-pf-help">{{ t('SEW_PERF_DEV_HELP') }}</div>
    <div class="se-pf-dv-list">
      <template v-if="devs.length">
        <div class="se-pf-dv-cols"><span>{{ L.devName }}</span><span>{{ L.devPct }}</span><span /></div>
        <template v-for="(d, i) in devs" :key="i">
          <div class="se-pf-dv" data-testid="se-perf-dev">
            <div class="nm">
              <b>{{ d.name || d.id }}</b><span class="se-pf-id">{{ d.id }}</span>
              <span v-if="d.sdwt" class="se-pf-tag">{{ d.sdwt }}</span>
              <span v-if="unregistered(d)" class="se-pf-tag am">{{ t('SEW_PERF_DEV_UNREG_TAG') }}</span>
              <span v-if="counts.get(d.id) > 1" class="se-pf-tag am">{{ t('SEW_PERF_DEV_DUP_TAG') }}</span>
            </div>
            <span class="se-pf-pct">
              <input class="se-pp-inp" :class="{ bad: rowBad(i) }" inputmode="numeric" :value="d.p" placeholder="1~100" :data-pf="`devp:${i}`"
                :aria-label="t('SEW_PERF_DEV_PCT', { name: d.name || d.id })" @input="ctx.setDevP(i, $event.target.value)">%
            </span>
            <button type="button" class="se-pf-dv-x" :data-pf="`devdel:${i}`" :aria-label="t('SEW_PERF_DEV_REMOVE', { name: d.name || d.id })"
              :title="t('SEW_PERF_DEV_REMOVE', { name: d.name || d.id })" @click="remove(i)">✕</button>
          </div>
          <div v-if="hasMsg(d, i)" class="se-pf-dv-msg">
            <PerformanceErrors :at="`dev:${i}`" />
            <PerformanceErrors :at="`devp:${i}`" />
            <div v-if="warnOf(d, i)" class="se-pf-warn">{{ warnOf(d, i) }}</div>
            <button v-if="isLater(d, i)" type="button" class="se-pf-btn-q" :data-pf="`merge:${i}`" @click="merge(i)">{{ t('SEW_PERF_DEV_MERGE', { name: d.name || d.id }) }}</button>
          </div>
        </template>
      </template>
      <div v-else class="se-pf-empty">{{ t('SEW_PERF_DEV_EMPTY') }}</div>
    </div>
    <PerformanceErrors at="devs" />
  </div>
</template>
