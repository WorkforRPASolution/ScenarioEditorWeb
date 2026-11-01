import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import DataCheckDialog from '../components/DataCheckDialog.vue'
import { useEditorStore } from '../stores/editorStore'

const ModalStub = { name: 'ModalShell', props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot /></div>' }
const empty = () => ({ duplicateUsers: [], duplicateEqpIds: [], invalidEquipment: [], proxyIpDuplicates: [], duplicateProperties: [] })

describe('DataCheckDialog', () => {
  let warn
  beforeEach(() => { setActivePinia(createPinia()); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('같은 문자열 항목이 여러 번 와도 줄마다 그리고 key 중복 경고가 없다', async () => {
    const s = useEditorStore()
    const bad = { eqpId: 'SEWT_BADMAIL', reason: 'WRONG_EMAIL_CATEGORY' }
    const other = { eqpId: 'SEWT_BADREQ', reason: 'REQUIRED_EMPTY' }
    s.dataCheck = { ...empty(), invalidEquipment: [bad, other] }
    const w = mount(DataCheckDialog, { props: { modelValue: true }, global: { stubs: { ModalShell: ModalStub } } })
    // Vue 는 순서가 바뀐 목록을 다시 그릴 때(patch) 키 중복을 검사한다 — 순서를 바꾸고 같은 줄을 더한다
    s.dataCheck = { ...empty(), invalidEquipment: [other, bad, bad] }
    await w.vm.$nextTick()
    expect(w.findAll('li').map((li) => li.text())).toEqual(['SEWT_BADREQ — 필수 필드 빈 값', 'SEWT_BADMAIL — 메일 분류 형식 오류(4토큰 아님)', 'SEWT_BADMAIL — 메일 분류 형식 오류(4토큰 아님)'])
    const dupWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('Duplicate keys'))
    expect(dupWarnings).toEqual([])
  })
})
