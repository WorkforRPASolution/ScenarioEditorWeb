// 보는 곳(LookStation) — 검색(OCR) 영역을 숫자로 넣기(2026-11-17 사내 요청). 패널(StepPanel)에 끼운 채로 본다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => `http://x/api${p}` }))
vi.mock('../editor/images', async (orig) => ({ ...(await orig()), loadBitmap: vi.fn(() => Promise.reject(new Error('no network in unit tests'))) }))
import StepPanel from '../components/StepPanel.vue'
import { t } from '../messages'
import { panelFixture, imageStep, ocrStep } from './panelFixture'

const mountPanel = () => mount(StepPanel, { attachTo: document.body })
const box = (w, k) => w.find(`[data-area="${k}"]`)
const values = (w) => ['x', 'y', 'w', 'h'].map((k) => box(w, k).element.value)
const type = async (w, k, value) => { const el = box(w, k); el.element.value = value; await el.trigger('input'); await el.trigger('change') }
const bad = (w) => ['x', 'y', 'w', 'h'].filter((k) => box(w, k).classes().includes('se-inp-bad'))
const areaOf = (e) => e.panel.draft.condition.searchArea

describe('LookStation — 영역을 숫자로 넣기', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('영역의 X·Y·W·H 가 입력 칸에 보인다(이미지·OCR)', async () => {
    const { s } = panelFixture([imageStep(0), ocrStep(1)])
    const w = mountPanel()
    expect(values(w)).toEqual(['10', '20', '300', '200'])
    expect(box(w, 'x').attributes('aria-label')).toBe(t('SEW_PANEL_AREA_X', { name: t('SEW_PANEL_AREA') }))
    expect(box(w, 'h').attributes('inputmode')).toBe('numeric')
    s.select('s1'); await flushPromises()
    expect(values(w)).toEqual(['1', '2', '30', '10'])
    expect(box(w, 'w').attributes('aria-label')).toBe(t('SEW_PANEL_AREA_W', { name: t('SEW_PANEL_OCR_AREA') }))
    w.unmount()
  })

  it('칸에 수를 치면 초안의 영역이 바뀌고 적용 줄에 이전 → 지금이 보인다. 적용하면 작업본에 들어간다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    await type(w, 'w', ' 310 ')
    expect(areaOf(e)).toEqual({ x: 10, y: 20, w: 310, h: 200 })
    expect(values(w)).toEqual(['10', '20', '310', '200'])
    expect(bad(w)).toEqual([])
    expect(box(w, 'w').classes()).toContain('se-inp-ch')
    const foot = w.find('[data-testid="se-panel-foot"]')
    expect(foot.text()).toContain(t('SEW_PANEL_AREA'))
    expect(foot.text()).toContain('300×200')
    expect(foot.text()).toContain('310×200')
    await w.find('[data-testid="se-panel-apply"]').trigger('click')
    expect(e.session.working.steps[0].condition.searchArea).toEqual({ x: 10, y: 20, w: 310, h: 200 })
    w.unmount()
  })

  it('같은 값을 치면 초안이 바뀌지 않는다', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    await type(w, 'x', '10')
    expect(e.panel.draft).toBe(edited.steps[0])
    expect(w.find('[data-testid="se-panel-foot"]').exists()).toBe(false)
    w.unmount()
  })

  it('글자·소수점은 그 칸만 붉게 하고 이유를 보이며 [적용]을 막는다 — 친 글자는 칸에 남는다', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    await type(w, 'w', '31o')
    expect(box(w, 'w').element.value).toBe('31o')
    expect(bad(w)).toEqual(['w'])
    // 오타 하나로 영역이 사라지지 않는다 — 영역은 마지막 바른 값이고(큰 화면·영역 그림·[다시 잡기] 그대로) 친 글자만 따로 쥔다
    expect(areaOf(e)).toEqual({ x: 10, y: 20, w: 300, h: 200 })
    expect(e.panel.draft.condition.areaTyped).toEqual({ w: '31o' })
    expect(w.find('[data-testid="se-look-area"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-cap-look"]').text()).toBe(t('SEW_CAP_REGRAB'))
    expect(w.find('[data-testid="se-panel-foot"]').text()).toContain(t('SEW_PANEL_CHANGED_N', { n: 1 }))
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_NOT_INTEGER', { names: 'W' }))
    const apply = w.find('[data-testid="se-panel-apply"]')
    expect(apply.attributes('data-blocked')).toBe('true')
    await apply.trigger('click')
    expect(e.session.working.steps[0]).toBe(edited.steps[0])
    expect(document.activeElement).toBe(box(w, 'w').element) // 막히면 걸린 칸으로
    await type(w, 'w', '12.5')
    expect(bad(w)).toEqual(['w'])
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_NOT_INTEGER', { names: 'W' }))
    await type(w, 'w', '')
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_FIELD_EMPTY', { names: 'W' }))
    await type(w, 'w', '0')
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_SIZE_MIN', { names: 'W' }))
    await type(w, 'w', '300')
    expect(bad(w)).toEqual([])
    expect(w.find('[data-err="area"]').exists()).toBe(false)
    expect(e.panelDirty()).toBe(false) // 원래 값으로 고치면 바뀐 것이 없다
    w.unmount()
  })

  it('음수와 기준 화면 밖: 걸린 칸(X·W 또는 Y·H)과 화면 크기를 알린다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.setScreenSize({ w: 400, h: 300 })
    const w = mountPanel(); await flushPromises()
    expect(w.find('[data-testid="se-area-screen"]').text()).toBe(t('SEW_PANEL_AREA_SCREEN', { w: 400, h: 300 }))
    await type(w, 'x', '-1')
    expect(bad(w)).toEqual(['x'])
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_NEGATIVE', { names: 'X' }))
    await type(w, 'x', '150')
    expect(bad(w)).toEqual(['x', 'w'])
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_OUT_RIGHT', { w: 400, h: 300, sum: 450 }))
    await type(w, 'x', '100')
    expect(bad(w)).toEqual([])
    await type(w, 'h', '281')
    expect(bad(w)).toEqual(['y', 'h'])
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_OUT_BOTTOM', { w: 400, h: 300, sum: 301 }))
    await type(w, 'h', '280') // 아래 끝에 꼭 맞음
    expect(bad(w)).toEqual([])
    w.unmount()
  })

  it('화면 크기를 모르면 화면 크기 글이 없다', () => {
    panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    expect(w.find('[data-testid="se-area-screen"]').exists()).toBe(false)
    w.unmount()
  })

  it('큰 화면에서 잡는 동안에는 칸이 잠기고 까닭이 보인다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    expect(box(w, 'x').attributes('disabled')).toBeUndefined()
    expect(e.startCapture(['area', 'train'])).toBe(true)
    await flushPromises()
    for (const k of ['x', 'y', 'w', 'h']) {
      expect(box(w, k).attributes('disabled')).toBeDefined()
      expect(box(w, k).attributes('title')).toBe(t('SEW_PANEL_AREA_LOCKED'))
    }
    e.cancelCapture(); await flushPromises()
    expect(box(w, 'x').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('새 스텝: 영역이 없으면 빈 칸이고, 네 칸을 치면 영역이 된다 — 다 치기 전에는 붉히지 않고, 틀린 값은 [넣기] 전에도 알린다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.setScreenSize({ w: 400, h: 300 })
    const w = mountPanel()
    expect(e.startNew('image')).toBe(true)
    e.finishCapture(); await flushPromises()
    expect(areaOf(e)).toBe(null)
    expect(values(w)).toEqual(['', '', '', ''])
    await type(w, 'x', '5')
    expect(areaOf(e)).toBe(null)
    expect(values(w)).toEqual(['5', '', '', ''])
    expect(bad(w)).toEqual([])
    expect(w.find('[data-err="area"]').exists()).toBe(false)
    await type(w, 'y', '6'); await type(w, 'w', '70'); await type(w, 'h', '8o')
    expect(bad(w)).toEqual(['h'])
    expect(w.find('[data-err="area"]').text()).toBe(t('RULE_AREA_NOT_INTEGER', { names: 'H' }))
    await w.find('[data-testid="se-new-add"]').trigger('click') // 잘못 친 글자가 남아 있으면 넣지 못한다
    expect(e.session.working.steps).toHaveLength(2)
    expect(e.panel.isNew).toBe(true)
    await type(w, 'h', '80')
    expect(areaOf(e)).toEqual({ x: 5, y: 6, w: 70, h: 80 })
    expect(bad(w)).toEqual([])
    await type(w, 'w', '700')
    expect(bad(w)).toEqual(['x', 'w'])
    await type(w, 'w', '70')
    w.unmount()
  })

  it('잘못 친 글자가 남은 채 큰 화면에서 영역을 잡으면 잡은 값이 칸에 들어오고, 잡기를 취소하면 친 글자가 돌아온다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    await type(w, 'w', '31o')
    expect(e.startCapture(['area', 'train'])).toBe(true)
    expect(await e.captureNext({ x: 40, y: 50, w: 60, h: 70 })).toBe(true)
    await flushPromises()
    expect(values(w)).toEqual(['40', '50', '60', '70'])
    expect(e.panel.draft.condition.areaTyped).toBeUndefined()
    e.cancelCapture(); await flushPromises()
    expect(values(w)).toEqual(['10', '20', '31o', '200'])
    expect(bad(w)).toEqual(['w'])
    w.unmount()
  })
})
