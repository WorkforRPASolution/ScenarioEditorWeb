<script setup>
// 바뀐 값의 "이전 → 지금". 글의 일부만 바뀌었으면 그 부분만 색으로 구분한다(editor/textDiff — 이전은 del, 지금은 ins).
// 통째로 바뀐 값(켜짐 → 꺼짐 등)은 색을 넣지 않는다. 글자는 그대로라 줄을 읽거나 복사한 글은 색이 없을 때와 같다.
import { computed } from 'vue'
import { diffParts } from '../editor/textDiff'
import './changeText.css'

defineOptions({ name: 'ChangeText' })
const props = defineProps({
  before: { type: [String, Number], default: '' },
  after: { type: [String, Number], default: '' }
})
const parts = computed(() => diffParts(props.before, props.after))
</script>

<template>
  <span class="se-df"><template v-for="(p, i) in parts.before" :key="`b${i}`"><del v-if="p.changed">{{ p.text }}</del><template v-else>{{ p.text }}</template></template> → <template v-for="(p, i) in parts.after" :key="`a${i}`"><ins v-if="p.changed">{{ p.text }}</ins><template v-else>{{ p.text }}</template></template></span>
</template>
