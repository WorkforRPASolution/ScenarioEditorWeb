// 위쪽 바의 [시나리오 지우기…](2026-11-10 사용자 결정) — 불러오기 창을 거치지 않고 열린 시나리오를 지운다. 확인 창은 불러오기 창의 것과 같다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ check: vi.fn(), nameRule: vi.fn(), list: vi.fn(), versions: vi.fn(), listDrafts: vi.fn(), removeScenario: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import ScenarioBar from '../components/ScenarioBar.vue'
import { t } from '../messages'
import { panelFixture, noneStep } from './panelFixture'

const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code) => Promise.reject({ response: { status, data: { code } }, request: {} })
const ModalStub = { name: 'ModalShell', props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot /></div>' }
const q = (id) => document.querySelector(`[data-testid="${id}"]`)
const DRAFT = { draftId: 'd9', name: 'N', target: { model: 'M', name: 'N' }, base: { crtime: 1, fileId: 'F' }, headCrtime: 1, savedAt: '2026-11-07T05:23:51.000Z', revision: 1 }

function setup({ canWrite = true, drafts = [], versions = [{ crtime: 1, isCurrent: true }, { crtime: 0, isCurrent: false }] } = {}) {
  const f = panelFixture([noneStep(0), noneStep(1)], { canWrite })
  f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '메일', timeoutLimit: '1', targetWindow: null }, property: { IsEnabled: true }, performance: null }
  f.s.scopes = { processes: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }] }] }
  api.versions.mockImplementation(() => ok(versions))
  api.listDrafts.mockImplementation(() => ok(drafts))
  api.list.mockImplementation(() => ok([]))
  const bar = mount(ScenarioBar, { attachTo: document.body, global: { stubs: { ModalShell: ModalStub, teleport: false } } })
  return { ...f, bar }
}
const toastText = () => document.querySelector('[data-test="toast"]')?.textContent ?? ''
const type = async (value) => { const el = q('se-load-del-name'); el.value = value; el.dispatchEvent(new Event('input')); await flushPromises() }

describe('ScenarioBar — 시나리오 지우기', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()); document.body.innerHTML = '' })

  it('쓸 수 있는 사용자가 배포된 시나리오를 열었을 때만 단추가 보인다 — 읽기 전용·새 시나리오·이미 지워진 화면에는 없다', async () => {
    const a = setup()
    expect(a.bar.find('[data-testid="se-delete"]').exists()).toBe(true)
    a.e.markDeleted()
    await a.bar.vm.$nextTick()
    expect(a.bar.find('[data-testid="se-delete"]').exists()).toBe(false)
    a.bar.unmount()
    setActivePinia(createPinia())
    const ro = setup({ canWrite: false })
    expect(ro.bar.find('[data-testid="se-delete"]').exists()).toBe(false)
    ro.bar.unmount()
    setActivePinia(createPinia())
    const n = setup()
    n.e.beginNew({ process: 'P', model: 'M', name: 'NEW_ONE', type: 1, description: '새', timeoutLimit: '240' })
    await n.bar.vm.$nextTick()
    expect(n.bar.find('[data-testid="se-delete"]').exists()).toBe(false)
    n.bar.unmount()
  })

  it('누르면 버전 수·설비 수를 읽어 확인 창을 띄우고, 이름을 치고 지우면 편집 화면이 읽기 전용(지워짐)이 된다', async () => {
    const { bar, e } = setup()
    await bar.find('[data-testid="se-delete"]').trigger('click'); await flushPromises()
    expect(api.versions).toHaveBeenCalledWith('P', 'M', 'N')
    const del = q('se-load-del')
    expect(del.textContent).toContain('P-M-N')
    expect(del.textContent).toContain('버전 2개 전부')
    expect(del.textContent).toContain('M 설비 3대')
    expect(del.textContent).toContain(t('SEW_LOAD_DEL_OPEN')) // 편집 화면에 열려 있는 시나리오
    expect(q('se-load-del-with-draft')).toBe(null) // 내 초안이 없다
    await type('N')
    api.removeScenario.mockReturnValue(ok({ deleted: true }))
    q('se-load-del-go').click(); await flushPromises()
    expect(api.removeScenario).toHaveBeenCalledWith('P', 'M', 'N', 'N', false)
    expect(q('se-load-del')).toBe(null)
    expect(e.session.readOnly).toBe('deleted')
    expect(toastText()).toContain(t('SEW_LOAD_DELETED_OPEN')) // 지워져 읽기 전용이 된 화면에서도 보이는 알림(편집 알림은 편집할 수 있을 때만 있다)
    expect(bar.find('[data-testid="se-bar-deleted"]').exists()).toBe(true)
    bar.unmount()
  })

  it('내 초안이 있으면 [내 초안도 함께 지웁니다] 체크 칸이 나오고, 함께 지우면 세션의 초안 표시도 지운다', async () => {
    const { bar, e } = setup({ drafts: [DRAFT] })
    e.markDraft?.({ draftId: 'd9', savedAt: DRAFT.savedAt, revision: 1 })
    await bar.find('[data-testid="se-delete"]').trigger('click'); await flushPromises()
    expect(api.listDrafts).toHaveBeenCalledWith('P', 'M')
    const box = q('se-load-del-with-draft')
    box.checked = true; box.dispatchEvent(new Event('change')); await flushPromises()
    await type('N')
    api.removeScenario.mockReturnValue(ok({ deleted: true, draftDeleted: true }))
    q('se-load-del-go').click(); await flushPromises()
    expect(api.removeScenario).toHaveBeenCalledWith('P', 'M', 'N', 'N', true)
    expect(e.session.draft ?? null).toBe(null)
    expect(toastText()).toContain(t('SEW_LOAD_DELETED_WITH_DRAFT_OPEN'))
    bar.unmount()
  })

  it('버전·초안을 읽지 못해도 확인 창은 뜬다(버전 수 모름·초안 체크 칸 없음), [취소] 는 아무것도 하지 않는다', async () => {
    const { bar, e } = setup()
    api.versions.mockImplementation(() => fail(503, 'UPSTREAM_DOWN'))
    api.listDrafts.mockImplementation(() => fail(503, 'UPSTREAM_DOWN'))
    await bar.find('[data-testid="se-delete"]').trigger('click'); await flushPromises()
    expect(q('se-load-del').textContent).toContain('버전 전부')
    expect(q('se-load-del-with-draft')).toBe(null)
    q('se-load-del-cancel').click(); await flushPromises()
    expect(q('se-load-del')).toBe(null)
    expect(api.removeScenario).not.toHaveBeenCalled()
    expect(e.session.readOnly).not.toBe('deleted')
    bar.unmount()
  })

  it('결과를 모르면 다시 보내지 않고 [목록 다시 읽기] 로 남았는지 확인한다 — 없어졌으면 읽기 전용, 남았으면 알리기만', async () => {
    const gone = setup()
    await gone.bar.find('[data-testid="se-delete"]').trigger('click'); await flushPromises()
    await type('N')
    api.removeScenario.mockReturnValue(fail(504, 'UPSTREAM_TIMEOUT'))
    q('se-load-del-go').click(); await flushPromises()
    api.list.mockImplementation(() => ok([{ name: 'OTHER' }]))
    q('se-load-del-relist').click(); await flushPromises()
    expect(api.removeScenario).toHaveBeenCalledTimes(1)
    expect(gone.e.session.readOnly).toBe('deleted')
    expect(toastText()).toContain(t('SEW_LOAD_RELISTED_GONE', { name: 'N' }))
    gone.bar.unmount()
    setActivePinia(createPinia()); document.body.innerHTML = ''
    const kept = setup()
    await kept.bar.find('[data-testid="se-delete"]').trigger('click'); await flushPromises()
    await type('N')
    api.removeScenario.mockReturnValue(fail(504, 'UPSTREAM_TIMEOUT'))
    q('se-load-del-go').click(); await flushPromises()
    api.list.mockImplementation(() => ok([{ name: 'N' }]))
    q('se-load-del-relist').click(); await flushPromises()
    expect(kept.e.session.readOnly).not.toBe('deleted')
    expect(toastText()).toContain(t('SEW_LOAD_RELISTED_KEPT', { name: 'N' }))
    expect(q('se-load-del')).toBe(null)
    kept.bar.unmount()
  })
})
