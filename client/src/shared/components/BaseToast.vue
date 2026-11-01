<script setup>
/**
 * BaseToast — useToast() 가 돌려주는 toast ref({ show, type, message }) 를 그대로 받아 그린다.
 *
 * useToast 는 호출한 컴포넌트마다 ref 를 새로 만들 뿐 화면에 아무것도 그리지 않는다.
 * showSuccess/showError 를 부르는 컴포넌트는 반드시 이 컴포넌트(또는 인라인 마크업)로 toast 를 렌더해야 한다 —
 * 그러지 않으면 메시지가 조용히 버려진다 (관용구 원장 E2E 에서 잡힌 결함).
 */
// useToast 를 mock 한 테스트가 toast 를 안 넘겨도 렌더가 죽지 않도록 기본값을 둔다
defineProps({
  toast: { type: Object, default: () => ({ show: false, type: 'info', message: '' }) },
})

const TYPE_CLASS = {
  success: 'bg-green-600',
  error: 'bg-red-600',
  warning: 'bg-amber-500',
  info: 'bg-blue-600',
}
</script>

<template>
  <div
    v-if="toast.show"
    role="status"
    aria-live="polite"
    data-test="toast"
    :class="[
      'fixed bottom-6 right-6 z-[70] max-w-[60vw] px-4 py-3 rounded-lg shadow-lg text-white text-sm break-words',
      TYPE_CLASS[toast.type] ?? TYPE_CLASS.info,
    ]"
  >
    {{ toast.message }}
  </div>
</template>
