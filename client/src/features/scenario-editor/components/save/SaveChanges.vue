<script setup>
// 바뀐 것(editor/diff unsavedChanges, 목업 svChanges). 스텝 줄은 그 스텝으로, 메일 제목·제한 시간은 바 칸으로, 운영 속성은 운영 속성 창으로.
import { computed } from 'vue'
import { useSaveFlow } from '../../stores/saveFlow'
import { useEditStore } from '../../stores/editStore'
import { diffLines } from '../../editor/panel'
import { t, LABELS } from '../../messages'

defineOptions({ name: 'SaveChanges' })
const emit = defineEmits(['go'])
const flow = useSaveFlow()
const edit = useEditStore()

const text = (v) => (v === '' || v === null || v === undefined ? t('SEW_SAVE_EMPTY_VALUE') : String(v))
const minutes = (v) => (v === '' || v === null || v === undefined ? t('SEW_SAVE_EMPTY_VALUE') : /^[0-9]+$/.test(String(v)) ? t('SEW_SAVE_MINUTES', { n: v }) : String(v))
const lineText = (l) => (l.before === '' && l.after === '' ? l.label : `${l.label} ${t('SEW_SAVE_DIFF_ARROW', { from: l.before, to: l.after })}`)

const rows = computed(() => {
  const s = edit.session
  if (!s?.working) return []
  const w = s.working
  const now = new Map(w.steps.map((x) => [x.uid, x]))
  const before = new Map((s.saveBase?.steps ?? []).map((x) => [x.uid, x]))
  const out = []
  const byUid = new Map()
  for (const c of flow.changes) {
    if (c.kind === 'field' && c.key === 'property') {
      out.push({ label: t('SEW_SAVE_CHANGE_PROPERTY'), sub: c.keys.map((k) => LABELS.propertyKey[k] ?? k).join(', '), goal: { kind: 'property' } })
    } else if (c.kind === 'field') {
      const desc = c.key === 'description'
      out.push({ label: t(desc ? 'SEW_SAVE_MAIL_TITLE' : 'SEW_SAVE_TIMEOUT'), sub: t('SEW_SAVE_DIFF_ARROW', { from: (desc ? text : minutes)(c.before), to: (desc ? text : minutes)(c.after) }), goal: { kind: 'bar', field: c.key } })
    } else if (c.kind === 'added') {
      out.push({ label: t('SEW_SAVE_CHANGE_ADDED', { no: c.no }), sub: now.get(c.uid)?.descriptionToEmail ?? '', goal: { kind: 'step', uid: c.uid } })
    } else if (c.kind === 'deleted') {
      out.push({ label: t('SEW_SAVE_CHANGE_DELETED', { no: c.no }), sub: before.get(c.uid)?.descriptionToEmail ?? '', goal: null })
    } else {
      // 고친 스텝과 순서가 바뀐 스텝은 한 줄로 — 바뀐 값들 · 순서 바뀜
      let r = byUid.get(c.uid)
      if (!r) {
        r = { label: t('SEW_SAVE_CHANGE_STEP', { no: c.no, desc: now.get(c.uid)?.descriptionToEmail ?? '' }), subs: [], goal: { kind: 'step', uid: c.uid } }
        byUid.set(c.uid, r)
        out.push(r)
      }
      if (c.kind === 'changed') r.subs.push(...diffLines(before.get(c.uid), now.get(c.uid), w).map(lineText))
      else r.subs.push(t('SEW_SAVE_CHANGE_MOVED'))
    }
  }
  return out.map((r) => (r.subs ? { ...r, sub: r.subs.join(' · ') } : r))
})
</script>

<template>
  <div>
    <div class="se-sv-t mt-3.5">{{ t('SEW_SAVE_CHANGES') }} <small v-if="rows.length">{{ t('SEW_SAVE_CHANGES_COUNT', { n: rows.length }) }}</small></div>
    <ul v-if="rows.length" class="se-sv-list">
      <li v-for="(r, i) in rows" :key="i">
        <button v-if="r.goal" type="button" class="se-sv-row" data-testid="se-save-change" @click="emit('go', r.goal)"><b>{{ r.label }}</b><small v-if="r.sub">{{ r.sub }}</small></button>
        <div v-else class="se-sv-row" data-testid="se-save-change"><b>{{ r.label }}</b><small v-if="r.sub">{{ r.sub }}</small></div>
      </li>
    </ul>
    <div v-else class="se-sv-none">{{ t('SEW_SAVE_CHANGES_NONE') }}</div>
  </div>
</template>
