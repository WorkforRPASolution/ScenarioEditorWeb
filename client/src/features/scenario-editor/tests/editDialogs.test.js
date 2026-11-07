import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => `http://x/api${p}` }))
import EditDialogs from '../components/EditDialogs.vue'
import StepPanel from '../components/StepPanel.vue'
import { t } from '../messages'
import { panelFixture, imageStep } from './panelFixture'

const setValue = async (w, sel, value) => { const el = w.find(sel); el.element.value = value; await el.trigger('input'); await el.trigger('change') }

describe('EditDialogs — 적용 안 한 변경 확인(guard)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const mk = () => {
    const f = panelFixture([imageStep(0), imageStep(1), imageStep(2)])
    const panel = mount(StepPanel, { attachTo: document.body })
    const dlg = mount(EditDialogs, { attachTo: document.body })
    return { ...f, panel, dlg }
  }

  it('정확도를 고치고 다른 줄을 누르면 확인 창 — [버리고 이동] 은 작업본 그대로·다른 줄 선택', async () => {
    const { s, e, edited, panel, dlg } = mk()
    await setValue(panel, '[data-field="accept"]', '0.85')
    e.clickRow('s1')
    await flushPromises()
    const g = dlg.find('[data-testid="se-guard"]')
    expect(g.exists()).toBe(true)
    expect(g.text()).toContain(t('SEW_EDIT_GUARD_TITLE', { no: 1 }))
    expect(g.text()).toContain(t('SEW_EDIT_GUARD_BODY_MOVE', { n: 1 }))
    expect(s.selectedUid).toBe('s0')
    await dlg.find('[data-testid="se-guard-drop"]').trigger('click')
    expect(e.session.working).toBe(edited)
    expect(s.selectedUid).toBe('s1')
    expect(dlg.find('[data-testid="se-guard"]').exists()).toBe(false)
    expect(panel.find('[data-field="accept"]').element.value).toBe('0.90')
    panel.unmount(); dlg.unmount()
  })

  it('[적용하고 이동] 은 작업본에 넣고 간다', async () => {
    const { s, e, edited, panel, dlg } = mk()
    await setValue(panel, '[data-field="accept"]', '0.85')
    e.clickRow('s2')
    await flushPromises()
    await dlg.find('[data-testid="se-guard-apply"]').trigger('click')
    expect(e.session.working.steps[0].condition.image.accept).toBe(0.85)
    expect(e.session.working.steps[1]).toBe(edited.steps[1])
    expect(s.selectedUid).toBe('s2')
    expect(e.undo).toHaveLength(1)
    panel.unmount(); dlg.unmount()
  })

  it('[계속 고치기]·Esc 는 창만 닫고 초안을 남긴다', async () => {
    const { s, e, panel, dlg } = mk()
    await setValue(panel, '[data-field="accept"]', '0.85')
    e.clickRow('s1'); await flushPromises()
    await dlg.find('[data-testid="se-guard-keep"]').trigger('click')
    expect(e.dialog).toBe(null)
    expect(s.selectedUid).toBe('s0')
    expect(e.panel.draft.condition.image.accept).toBe(0.85)
    e.clickRow('s1'); await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(e.dialog).toBe(null)
    expect(s.selectedUid).toBe('s0')
    panel.unmount(); dlg.unmount()
  })

  it('[적용하고 이동] 은 오류가 있으면 가지 않고 오류 칸으로 초점', async () => {
    const { s, e, edited, panel, dlg } = mk()
    await setValue(panel, '[data-field="desc"]', '')
    e.clickRow('s1'); await flushPromises()
    await dlg.find('[data-testid="se-guard-apply"]').trigger('click')
    await flushPromises()
    expect(e.session.working).toBe(edited)
    expect(s.selectedUid).toBe('s0')
    expect(document.activeElement.getAttribute('data-field')).toBe('desc')
    panel.unmount(); dlg.unmount()
  })

  it('확인 창이 떠 있는 동안 알림 줄의 [되돌리기] 는 숨긴다(창 위에 떠 있어 미룬 일을 덮어쓰지 않게)', async () => {
    const { e, panel, dlg } = mk()
    e.editCell('s1', 'skip', true)
    await flushPromises()
    expect(dlg.find('[data-testid="se-toast"] button').exists()).toBe(true)
    await setValue(panel, '[data-field="accept"]', '0.85')
    e.clickRow('s2'); await flushPromises()
    expect(dlg.find('[data-testid="se-guard"]').exists()).toBe(true)
    expect(dlg.find('[data-testid="se-toast"] button').exists()).toBe(false)
    panel.unmount(); dlg.unmount()
  })

  it('작업본 명령 앞은 [버리고 계속]·[적용하고 계속], 되돌리기·다시 하기 앞은 [버리고 되돌리기]·[버리고 다시 하기] 만(R-T6c)', async () => {
    const { e, panel, dlg } = mk()
    e.editCell('s1', 'skip', true); await flushPromises()
    await setValue(panel, '[data-field="accept"]', '0.85')
    e.editCell('s2', 'skip', true); await flushPromises()
    expect(dlg.find('[data-testid="se-guard"]').text()).toContain(t('SEW_EDIT_GUARD_BODY_OTHER', { n: 1 }))
    expect(dlg.find('[data-testid="se-guard-drop"]').text()).toBe(t('SEW_EDIT_GUARD_DROP_CONTINUE'))
    expect(dlg.find('[data-testid="se-guard-apply"]').text()).toBe(t('SEW_EDIT_GUARD_APPLY_CONTINUE'))
    e.guardKeep(); await flushPromises()
    e.undoCommand(); await flushPromises()
    expect(dlg.find('[data-testid="se-guard"]').text()).toContain(t('SEW_EDIT_GUARD_BODY_UNDO', { n: 1 }))
    expect(dlg.find('[data-testid="se-guard-drop"]').text()).toBe(t('SEW_EDIT_GUARD_DROP_UNDO'))
    expect(dlg.find('[data-testid="se-guard-apply"]').exists()).toBe(false)
    await dlg.find('[data-testid="se-guard-drop"]').trigger('click')
    expect(e.session.working.steps[1].condition.skipPreprocessing).toBe(false)
    await flushPromises()
    await setValue(panel, '[data-field="accept"]', '0.85')
    e.redoCommand(); await flushPromises()
    expect(dlg.find('[data-testid="se-guard-drop"]').text()).toBe(t('SEW_EDIT_GUARD_DROP_REDO'))
    expect(dlg.find('[data-testid="se-guard-apply"]').exists()).toBe(false)
    panel.unmount(); dlg.unmount()
  })
  it('다른 시나리오 열기 앞은 [버리고 이동]·[적용하고 이동] 과 열기 문구', async () => {
    const { e, panel, dlg } = mk()
    await setValue(panel, '[data-field="accept"]', '0.85')
    e.guard(() => {}, { action: 'open' }); await flushPromises()
    expect(dlg.find('[data-testid="se-guard"]').text()).toContain(t('SEW_EDIT_GUARD_BODY_OPEN', { n: 1 }))
    expect(dlg.find('[data-testid="se-guard-drop"]').text()).toBe(t('SEW_EDIT_GUARD_DROP'))
    expect(dlg.find('[data-testid="se-guard-apply"]').text()).toBe(t('SEW_EDIT_GUARD_APPLY'))
    panel.unmount(); dlg.unmount()
  })

  it('저장 창 열기 앞(목업 조작판 22)은 버튼 문구가 다르다', async () => {
    const { e, panel, dlg } = mk()
    await setValue(panel, '[data-field="accept"]', '0.85')
    const open = vi.fn()
    expect(e.guard(open, { action: 'save' })).toBe(false)
    await flushPromises()
    expect(dlg.find('[data-testid="se-guard"]').text()).toContain(t('SEW_EDIT_GUARD_BODY_SAVE', { n: 1 }))
    expect(dlg.find('[data-testid="se-guard-drop"]').text()).toBe(t('SEW_EDIT_GUARD_DROP_SAVE'))
    expect(dlg.find('[data-testid="se-guard-apply"]').text()).toBe(t('SEW_EDIT_GUARD_APPLY_SAVE'))
    await dlg.find('[data-testid="se-guard-drop"]').trigger('click')
    expect(open).toHaveBeenCalledTimes(1)
    panel.unmount(); dlg.unmount()
  })
})
