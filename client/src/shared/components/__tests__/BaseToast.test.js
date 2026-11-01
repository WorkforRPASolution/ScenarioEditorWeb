import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BaseToast from '../BaseToast.vue'

/**
 * BaseToast — useToast() 의 toast ref({show,type,message}) 를 그대로 받아 그리는 표시 전용 컴포넌트.
 * useToast 는 컴포넌트마다 ref 를 새로 만들 뿐 아무것도 렌더하지 않는다 — 렌더는 이 컴포넌트가 맡는다.
 */
describe('BaseToast', () => {
  it('show=false 면 아무것도 그리지 않는다', () => {
    const w = mount(BaseToast, { props: { toast: { show: false, type: 'success', message: '숨김' } } })
    expect(w.find('[data-test="toast"]').exists()).toBe(false)
  })

  it('show=true 면 메시지를 role=status 로 그리고 type 별 색을 입힌다', async () => {
    const w = mount(BaseToast, { props: { toast: { show: true, type: 'success', message: '등록됨: x' } } })
    const el = w.find('[data-test="toast"]')
    expect(el.exists()).toBe(true)
    expect(el.attributes('role')).toBe('status')
    expect(el.text()).toBe('등록됨: x')
    expect(el.classes()).toContain('bg-green-600')

    await w.setProps({ toast: { show: true, type: 'error', message: '실패' } })
    expect(w.find('[data-test="toast"]').classes()).toContain('bg-red-600')
    await w.setProps({ toast: { show: true, type: 'warning', message: '주의' } })
    expect(w.find('[data-test="toast"]').classes()).toContain('bg-amber-500')
    await w.setProps({ toast: { show: true, type: 'info', message: '안내' } })
    expect(w.find('[data-test="toast"]').classes()).toContain('bg-blue-600')
  })

  it('show 가 false 로 바뀌면 사라진다', async () => {
    const toast = { show: true, type: 'success', message: '잠깐' }
    const w = mount(BaseToast, { props: { toast } })
    expect(w.find('[data-test="toast"]').exists()).toBe(true)
    await w.setProps({ toast: { ...toast, show: false } })
    await nextTick()
    expect(w.find('[data-test="toast"]').exists()).toBe(false)
  })
})
