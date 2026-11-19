<script setup>
// 바뀐 것(editor/diff unsavedChanges, 목업 svChanges). 스텝 줄은 그 스텝으로, 메일 제목·제한 시간은 바 칸으로, 운영 속성은 운영 속성 창으로.
import { computed } from 'vue'
import { useSaveFlow } from '../../stores/saveFlow'
import { useEditStore } from '../../stores/editStore'
import { diffLines } from '../../editor/panel'
import { propertyDiffs } from '../../editor/propertyView'
import { windowLabel } from '../../editor/windows'
import { t } from '../../messages'
import ChangeText from '../ChangeText.vue'

defineOptions({ name: 'SaveChanges' })
const emit = defineEmits(['go'])
const flow = useSaveFlow()
const edit = useEditStore()

const text = (v) => (v === '' || v === null || v === undefined ? t('SEW_SAVE_EMPTY_VALUE') : String(v))
const plain = (v) => (v ? [{ text: v }] : [])
const minutes = (v) => (v === '' || v === null || v === undefined ? t('SEW_SAVE_EMPTY_VALUE') : /^[0-9]+$/.test(String(v)) ? t('SEW_SAVE_MINUTES', { n: v }) : String(v))
// 줄 아래 글은 조각 목록이다: { text } 는 글 그대로, { label, before, after } 는 "이름 이전 → 지금"(바뀐 부분만 색 — ChangeText)
const arrow = (label, before, after) => ({ label, before, after })
const lineOf = (l) => (l.before === '' && l.after === '' ? { text: l.label } : arrow(l.label, l.before, l.after))
// 창 조건 한 줄 글(P2-F): 제목 / 클래스 [좌표]
const winText = (w) => windowLabel(w, { anyTitle: t('SEW_PP_ANY_TITLE'), noClass: t('SEW_PP_NO_CLASS') })

const rows = computed(() => {
  const s = edit.session
  if (!s?.working) return []
  const w = s.working
  const now = new Map(w.steps.map((x) => [x.uid, x]))
  const before = new Map((s.saveBase?.steps ?? []).map((x) => [x.uid, x]))
  // 저장 기준점과 작업본의 출처 판이 다를 수 있다(되돌려 연 세션) — 그림은 내용 지문으로 견준다(SEW-019)
  const across = { baseSource: s.saveBase?.source ?? null, draftSource: w.source ?? null, fps: s.imageFp }
  const out = []
  const byUid = new Map()
  for (const c of flow.changes) {
    if (c.kind === 'field' && c.key === 'property') {
      // 칸 이름만 늘어놓으면 "켜짐" 같은 이름이 값으로 읽힌다 — 운영 속성 창의 "바뀐 값" 과 같은 글로 이전 → 지금을 보인다(목업 svChanges)
      out.push({ label: t('SEW_SAVE_CHANGE_PROPERTY'), subs: propertyDiffs(s.saveBase?.property, w.property).map((d) => arrow(d.label, d.from, d.to)), goal: { kind: 'property' } })
    } else if (c.kind === 'field' && c.key === 'targetWindow') {
      out.push({ label: t('SEW_SAVE_CHANGE_TARGET_WINDOW'), subs: [arrow('', winText(c.before), winText(c.after))], goal: { kind: 'windows', which: 'target' } })
    } else if (c.kind === 'field' && c.key === 'hidingWindows') {
      out.push({
        label: t('SEW_SAVE_CHANGE_HIDING_WINDOWS'),
        subs: [
          ...c.changed.map((x) => arrow('', winText(x.before), winText(x.after))),
          ...c.added.map((x) => ({ text: t('SEW_SAVE_CHANGE_HIDING_ADDED', { text: winText(x) }) })),
          ...c.removed.map((x) => ({ text: t('SEW_SAVE_CHANGE_HIDING_REMOVED', { text: winText(x) }) }))
        ],
        goal: { kind: 'windows', which: null }
      })
    } else if (c.kind === 'field') {
      const desc = c.key === 'description'
      out.push({ label: t(desc ? 'SEW_SAVE_MAIL_TITLE' : 'SEW_SAVE_TIMEOUT'), subs: [arrow('', (desc ? text : minutes)(c.before), (desc ? text : minutes)(c.after))], goal: { kind: 'bar', field: c.key } })
    } else if (c.kind === 'added') {
      out.push({ label: t('SEW_SAVE_CHANGE_ADDED', { no: c.no }), subs: plain(now.get(c.uid)?.descriptionToEmail), goal: { kind: 'step', uid: c.uid } })
    } else if (c.kind === 'deleted') {
      out.push({ label: t('SEW_SAVE_CHANGE_DELETED', { no: c.no }), subs: plain(before.get(c.uid)?.descriptionToEmail), goal: null })
    } else {
      // 고친 스텝과 순서가 바뀐 스텝은 한 줄로 — 바뀐 값들 · 순서 바뀜
      let r = byUid.get(c.uid)
      if (!r) {
        r = { label: t('SEW_SAVE_CHANGE_STEP', { no: c.no, desc: now.get(c.uid)?.descriptionToEmail ?? '' }), subs: [], goal: { kind: 'step', uid: c.uid } }
        byUid.set(c.uid, r)
        out.push(r)
      }
      if (c.kind === 'changed') r.subs.push(...diffLines(before.get(c.uid), now.get(c.uid), w, across).map(lineOf))
      else r.subs.push({ text: t('SEW_SAVE_CHANGE_MOVED') })
    }
  }
  return out
})
</script>

<template>
  <div>
    <div class="se-sv-t mt-3.5">{{ t('SEW_SAVE_CHANGES') }} <small v-if="rows.length">{{ t('SEW_SAVE_CHANGES_COUNT', { n: rows.length }) }}</small></div>
    <ul v-if="rows.length" class="se-sv-list">
      <li v-for="(r, i) in rows" :key="i">
        <component :is="r.goal ? 'button' : 'div'" :type="r.goal ? 'button' : undefined" class="se-sv-row" data-testid="se-save-change" @click="r.goal && emit('go', r.goal)">
          <b>{{ r.label }}</b>
          <small v-if="r.subs.length"><template v-for="(x, k) in r.subs" :key="k"><template v-if="k">{{ ' · ' }}</template><template v-if="x.text !== undefined">{{ x.text }}</template><template v-else><template v-if="x.label">{{ `${x.label} ` }}</template><ChangeText :before="x.before" :after="x.after" /></template></template></small>
        </component>
      </li>
    </ul>
    <div v-else class="se-sv-none">{{ t('SEW_SAVE_CHANGES_NONE') }}</div>
  </div>
</template>
