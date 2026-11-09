<script setup>
// 담당과 이력(목업 v2 peopleBlock, 2026-11-08 목업 뒤 창의 원개발자): 원개발자(기여도)·수정 이력(Owners, 최근 먼저).
import { computed, inject } from 'vue'
import { useEditorStore } from '../../stores/editorStore'
import { LABELS } from '../../messages'

defineOptions({ name: 'PropertyPeople' })
const ctx = inject('sePropertyCtx')
const store = useEditorStore()
const P = LABELS.prop

const devs = computed(() => store.skeleton?.performance?.citizenDevelopers ?? [])
const width = (c) => `${Math.min(100, Math.max(0, Number(c) || 0))}%`
// Owners 한 줄 = "아이디@시각[@메모]"(사내 형식). 마지막 줄이 가장 최근이다.
const history = computed(() => (Array.isArray(ctx.p?.Owners) ? ctx.p.Owners : []).map((line) => {
  const [who, at = '', ...rest] = String(line).split('@')
  return { who, at, note: rest.join('@') }
}).reverse())
</script>

<template>
  <h4>{{ P.people }}</h4>
  <template v-if="devs.length">
    <div class="se-pp-sub-t" style="margin-top: 0">{{ P.devs }}</div>
    <div v-for="(d, i) in devs" :key="i" class="se-pp-dev">
      <span class="nm" :title="`${d.knoxId}, ${d.sdwt}`">{{ d.name }} <span class="se-pp-who">{{ d.knoxId }}</span></span>
      <span class="se-pp-bar"><i :style="{ width: width(d.contribution) }" /></span>
      <span class="pct">{{ d.contribution }}%</span>
    </div>
  </template>
  <div v-else class="se-pp-who">{{ P.devsNone }}</div>
  <div class="se-pp-sub-t">{{ P.history }}</div>
  <ul v-if="history.length" class="se-pp-hist">
    <li v-for="(h, i) in history" :key="i"><span class="break-all">{{ h.who }} <span class="se-pp-who">{{ h.note }}</span></span><time>{{ h.at }}</time></li>
  </ul>
  <div v-else class="se-pp-empty">{{ P.historyNone }}</div>
</template>
