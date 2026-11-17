// 시험 줄(P4 설계 §4.1~§4.5): "찾는 것" 아래의 칸·[시험]·결과. 편집 패널과 읽기 전용 상세가 함께 쓴다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: { visionTest: vi.fn(), ocrTest: vi.fn() }, imageUrl: (p) => `http://x/api${p}` }))
vi.mock('../editor/images', async (orig) => ({ ...(await orig()), loadBitmap: vi.fn(() => Promise.reject(new Error('no network in unit tests'))) }))
import TestStation from '../components/panel/TestStation.vue'
import StepPanel from '../components/StepPanel.vue'
import StepDetail from '../components/StepDetail.vue'
import { useVisionTestStore } from '../stores/visionTestStore'
import { useSnapshotStore } from '../stores/snapshotStore'
import { useEditStore } from '../stores/editStore'
import { testInputOfDraft, testKey, valueKey } from '../editor/visionTest'
import { t } from '../messages'
import { panelFixture, imageStep, ocrStep, noneStep, eqpStep } from './panelFixture'

const ctx = { session: { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' } }, uploads: new Map(), draftId: null }
const IMAGE = (over) => testInputOfDraft(imageStep(0, over), ctx) // 영역 (10,20) 300×200, 정확도 0.9, 누를 곳 (24,12)
const OCR = (over) => testInputOfDraft(ocrStep(1, over), ctx, null)
const BASE = { kind: 'base' }
const at = (w, id) => w.find(`[data-testid="${id}"]`)
const all = (w, id) => w.findAll(`[data-testid="${id}"]`)
const type = async (w, id, value) => { const el = at(w, id); el.element.value = value; await el.trigger('input') }
const mountRow = (props) => mount(TestStation, { props: { editable: true, ...props }, attachTo: document.body })
// 큰 화면에 스냅샷이 떠 있는 것처럼
// (흉내가 저장소의 반응형 값 하나를 읽게 해, 그 값을 건드리면 화면이 다시 계산하게 한다)
function showSnapshot(snap) {
  const state = { on: true }
  vi.spyOn(snap, 'shownImage').mockImplementation(() => (snap.eqpId, state.on ? { eqpId: 'SEWT_PHOTO_A01', fileName: '1763000000000_[1][2].png', blob: new Blob(['x']) } : null))
  return state
}
const imageDone = (input, over = {}) => ({
  status: 'done', kind: 'image', key: testKey(input, BASE), valueKey: valueKey(input, 0.9), screen: 'base',
  results: [{ score: 0.97314, x: 96, y: 150 }, { score: 0.93, x: 96, y: 206 }], train: { w: 255, h: 96 }, click: { x: 120, y: 162 },
  verdict: { ok: true, rule: null }, crop: { x: 10, y: 20, w: 300, h: 200 }, size: { w: 1920, h: 1200 }, ms: 404, picked: 0, stale: false, ...over
})
const ocrDone = (input, over = {}) => ({
  status: 'done', kind: 'ocr', key: testKey(input, BASE), valueKey: valueKey(input, null), screen: 'base',
  accepted: true, lines: ['IDLE', 'READY'], confidence: { values: [96, 91, 88, 97], min: 88 }, numeric: false, noSuffix: false, ms: 812, stale: false, ...over
})

let store
let snap
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  store = useVisionTestStore()
  snap = useSnapshotStore()
})
afterEach(() => { vi.useRealTimers() })

describe('시험 줄 — 칸과 [시험]', () => {
  it('시험할 스텝이 없으면(조건 없음·설비 상태) 아무것도 그리지 않는다', () => {
    const w = mountRow({ input: null })
    expect(at(w, 'se-test').exists()).toBe(false)
    w.unmount()
  })

  it('이미지: 시험할 화면·시험 정확도(패널 값으로 시작)·[시험]. 떠 있는 스냅샷이 없으면 스냅샷 항목이 꺼져 있다', () => {
    const w = mountRow({ input: IMAGE() })
    const row = at(w, 'se-test')
    expect(row.attributes('data-kind')).toBe('image')
    expect(row.text()).toContain(t('SEW_TEST_TITLE'))
    expect(row.text()).toContain(t('SEW_TEST_HINT'))
    const options = at(w, 'se-test-screen').findAll('option')
    expect(options.map((o) => o.text())).toEqual([t('SEW_TEST_SCREEN_BASE'), t('SEW_TEST_SCREEN_SNAPSHOT_NONE')])
    expect(options[1].element.disabled).toBe(true)
    expect(at(w, 'se-test-screen').element.value).toBe('base')
    expect(at(w, 'se-test-accept').element.value).toBe('0.90')
    expect(at(w, 'se-test-run').element.disabled).toBe(false)
    expect(at(w, 'se-test-run').attributes('title')).toBeUndefined()
    expect(at(w, 'se-test-close').exists()).toBe(false)
    expect(at(w, 'se-test-result').exists()).toBe(false)
    w.unmount()
  })

  it('OCR: 정확도 칸·[스텝에 넣기] 가 없다. 읽기 전용이면 "저장된 값으로"', () => {
    const w = mountRow({ input: OCR(), editable: false })
    expect(at(w, 'se-test').attributes('data-kind')).toBe('ocr')
    expect(at(w, 'se-test-accept').exists()).toBe(false)
    expect(at(w, 'se-test-apply').exists()).toBe(false)
    expect(at(w, 'se-test').text()).toContain(t('SEW_TEST_HINT_READONLY'))
    expect(at(w, 'se-test-run').element.disabled).toBe(false)
    w.unmount()
  })

  it('[시험] 이 꺼진 까닭은 title 로: 찾을 그림 없음·정확도가 0~1 이 아님·OCR 값 없음', async () => {
    let w = mountRow({ input: IMAGE({ images: { train: {}, base: { from: 'source', id: 's0-bi' } } }) })
    expect(at(w, 'se-test-run').element.disabled).toBe(true)
    expect(at(w, 'se-test-run').attributes('title')).toBe(t('SEW_TEST_WHY_NO_TRAIN'))
    w.unmount()

    w = mountRow({ input: IMAGE() })
    await type(w, 'se-test-accept', '1.2')
    expect(at(w, 'se-test-run').element.disabled).toBe(true)
    expect(at(w, 'se-test-run').attributes('title')).toBe(t('SEW_TEST_WHY_ACCEPT'))
    await type(w, 'se-test-accept', '0.7')
    expect(at(w, 'se-test-run').element.disabled).toBe(false)
    w.unmount()

    const o = ocrStep(1)
    w = mountRow({ input: OCR({ condition: { ...o.condition, ocr: { ...o.condition.ocr, text: '' } } }) })
    expect(at(w, 'se-test-run').attributes('title')).toBe(t('SEW_TEST_WHY_OCR_VALUE'))
    w.unmount()
  })

  it('시험할 화면: 스냅샷이 떠 있으면 고를 수 있고, 고른 뒤 스냅샷이 사라지면 [시험] 이 꺼진다(고른 값은 남는다)', async () => {
    const shown = showSnapshot(snap)
    const w = mountRow({ input: IMAGE() })
    const sel = at(w, 'se-test-screen')
    expect(sel.findAll('option')[1].element.disabled).toBe(false)
    expect(sel.findAll('option')[1].text()).toBe(t('SEW_TEST_SCREEN_SNAPSHOT'))
    await sel.setValue('snapshot')
    expect(store.screen).toBe('snapshot')
    expect(at(w, 'se-test-run').element.disabled).toBe(false)
    shown.on = false
    snap.eqpId = 'SEWT_CVD_A01'
    await flushPromises()
    expect(store.screen).toBe('snapshot')
    expect(at(w, 'se-test-run').element.disabled).toBe(true)
    expect(at(w, 'se-test-run').attributes('title')).toBe(t('SEW_TEST_WHY_NO_SNAPSHOT'))
    w.unmount()
  })

  it('시험 정확도: 0.5 아래는 경고만(시험은 된다), [스텝에 넣기] 는 0.5~1 이고 패널 값과 다를 때만 켜진다', async () => {
    const w = mountRow({ input: IMAGE() })
    expect(at(w, 'se-test-accept-low').exists()).toBe(false)
    expect(at(w, 'se-test-apply').element.disabled).toBe(true) // 패널 값과 같다
    await type(w, 'se-test-accept', '0.4')
    expect(at(w, 'se-test-accept-low').text()).toBe(t('SEW_TEST_ACCEPT_LOW'))
    expect(at(w, 'se-test-run').element.disabled).toBe(false)
    expect(at(w, 'se-test-apply').element.disabled).toBe(true)
    await type(w, 'se-test-accept', '0.85')
    expect(at(w, 'se-test-accept-low').exists()).toBe(false)
    expect(at(w, 'se-test-apply').element.disabled).toBe(false)
    expect(at(w, 'se-test-apply').attributes('title')).toBe(t('SEW_TEST_APPLY_ACCEPT_HINT'))
    await at(w, 'se-test-apply').trigger('click')
    expect(w.emitted('accept')).toEqual([[0.85]])
    w.unmount()
  })

  it('읽기 전용에는 [스텝에 넣기] 가 없다', () => {
    const w = mountRow({ input: IMAGE(), editable: false })
    expect(at(w, 'se-test-accept').exists()).toBe(true)
    expect(at(w, 'se-test-apply').exists()).toBe(false)
    w.unmount()
  })

  it('시험 정확도는 손대기 전에는 패널 값을 따라가고, 손댄 뒤에는 그대로, 스텝이 바뀌면 다시 패널 값', async () => {
    const step = imageStep(0)
    const withAccept = (s, accept) => testInputOfDraft({ ...s, condition: { ...s.condition, image: { ...s.condition.image, accept } } }, ctx)
    const w = mountRow({ input: withAccept(step, 0.9) })
    await w.setProps({ input: withAccept(step, 0.8) })
    expect(at(w, 'se-test-accept').element.value).toBe('0.80')
    await type(w, 'se-test-accept', '0.6')
    await w.setProps({ input: withAccept(step, 0.75) })
    expect(at(w, 'se-test-accept').element.value).toBe('0.6')
    await w.setProps({ input: withAccept(imageStep(1), 0.95) })
    expect(at(w, 'se-test-accept').element.value).toBe('0.95')
    w.unmount()
  })

  it('[시험] 을 누르면 저장소가 그 입력으로 시험을 시작한다(무엇을 시험했는지 함께)', async () => {
    const start = vi.spyOn(store, 'start').mockResolvedValue(true)
    const input = IMAGE()
    const about = { process: 'P', model: 'M', scenario: 'N', step: 1 }
    const w = mountRow({ input, about })
    await at(w, 'se-test-run').trigger('click')
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0]).toStrictEqual(input)
    expect(start.mock.calls[0][1]).toEqual({ about })
    w.unmount()
  })
})

describe('시험 줄 — 상태와 결과', () => {
  it('시험 중: 버튼이 꺼지고 "시험 중… n초" 가 1초마다 오른다. 닫기 버튼은 없다', async () => {
    vi.useFakeTimers()
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = { status: 'running', kind: 'image', key: testKey(input, BASE), valueKey: valueKey(input, 0.9), screen: 'base', startedAt: Date.now() }
    await w.vm.$nextTick()
    expect(at(w, 'se-test-run').element.disabled).toBe(true)
    expect(at(w, 'se-test-run').attributes('title')).toBe(t('SEW_TEST_WHY_RUNNING'))
    expect(at(w, 'se-test-progress').text()).toBe(t('SEW_TEST_RUNNING', { n: 0 }))
    expect(at(w, 'se-test-close').exists()).toBe(false)
    vi.advanceTimersByTime(2100)
    await w.vm.$nextTick()
    expect(at(w, 'se-test-progress').text()).toBe(t('SEW_TEST_RUNNING', { n: 2 }))
    w.unmount()
  })

  it('Vision 결과: 머리(n곳·ms, 조건에 맞으면 초록)·표(순번·점수 넷째 자리·X·Y)·첫 줄의 누를 곳·안내', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = imageDone(input)
    await w.vm.$nextTick()
    const result = at(w, 'se-test-result')
    expect(result.attributes('data-status')).toBe('done')
    expect(result.attributes('data-stale')).toBe('false')
    expect(at(w, 'se-test-head').text()).toBe(t('SEW_TEST_FOUND', { n: 2, ms: 404 }))
    expect(at(w, 'se-test-head').attributes('data-ok')).toBe('true')
    const rows = all(w, 'se-test-row')
    expect(rows.map((r) => r.findAll('td').map((c) => c.text()))).toEqual([
      [t('SEW_TEST_ROW_CLICK', { n: 1 }), '0.9731', '96', '150'],
      ['2', '0.9300', '96', '206']
    ])
    expect(rows.map((r) => r.attributes('aria-selected'))).toEqual(['true', 'false'])
    expect(at(w, 'se-test-rule').exists()).toBe(false)
    expect(at(w, 'se-test-note').text()).toBe(t('SEW_TEST_NOTE'))
    expect(at(w, 'se-test-close').exists()).toBe(true)
    w.unmount()
  })

  it('결과 표의 줄을 누르면 그 줄이 고른 줄이 된다(큰 화면이 그 사각형을 굵게 그린다)', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = imageDone(input)
    await w.vm.$nextTick()
    await all(w, 'se-test-row')[1].trigger('click')
    expect(store.run.picked).toBe(1)
    expect(all(w, 'se-test-row').map((r) => r.attributes('aria-selected'))).toEqual(['false', 'true'])
    w.unmount()
  })

  it('누를 곳이 없는 스텝(마우스 클릭이 아님)은 첫 줄에 "누를 곳" 을 붙이지 않는다', async () => {
    const input = IMAGE({ action: { type: 0, typeName: 'None', raw: '' } })
    const w = mountRow({ input })
    store.run = imageDone(input, { click: null })
    await w.vm.$nextTick()
    expect(all(w, 'se-test-row')[0].findAll('td')[0].text()).toBe('1')
    w.unmount()
  })

  it('다중 검사가 걸리는 스텝: 조건 줄, 맞지 않으면 머리가 붉다', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = imageDone(input, { verdict: { ok: false, rule: { count: 3, op: 1 } } })
    await w.vm.$nextTick()
    expect(at(w, 'se-test-head').attributes('data-ok')).toBe('false')
    expect(at(w, 'se-test-rule').text()).toBe(t('SEW_TEST_RULE', { rule: t('SEW_TEST_RULE_1', { count: 3 }), n: 2 }))
    w.unmount()
  })

  it('못 찾음: "찾지 못했습니다 · ms"(붉음)·표 없음·판정 서버가 그림을 못 읽었을 수도 있다는 안내', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = imageDone(input, { results: [], click: null, verdict: { ok: false, rule: null }, ms: 380 })
    await w.vm.$nextTick()
    expect(at(w, 'se-test-head').text()).toBe(t('SEW_TEST_NOT_FOUND', { ms: 380 }))
    expect(at(w, 'se-test-head').attributes('data-ok')).toBe('false')
    expect(all(w, 'se-test-row')).toHaveLength(0)
    expect(all(w, 'se-test-note').map((n) => n.text())).toEqual([t('SEW_TEST_NOTE_NONE'), t('SEW_TEST_NOTE')])
    w.unmount()
  })

  it('OCR 결과(글 비교): 맞음·읽은 줄마다 한 줄·신뢰도는 가장 낮은 값과 글자별 값', async () => {
    const input = OCR()
    const w = mountRow({ input })
    store.run = ocrDone(input)
    await w.vm.$nextTick()
    expect(at(w, 'se-test-head').text()).toBe(t('SEW_TEST_OCR_OK', { ms: 812 }))
    expect(at(w, 'se-test-head').attributes('data-ok')).toBe('true')
    expect(at(w, 'se-test-result').text()).toContain(t('SEW_TEST_OCR_READ'))
    expect(all(w, 'se-test-line').map((l) => l.text())).toEqual(['IDLE', 'READY'])
    expect(at(w, 'se-test-conf').text()).toContain(t('SEW_TEST_OCR_CONF', { min: 88 }))
    expect(at(w, 'se-test-conf').text()).toContain(t('SEW_TEST_OCR_CONF_EACH', { list: '96 91 88 97' }))
    expect(at(w, 'se-test-nosuffix').exists()).toBe(false)
    expect(at(w, 'se-test-note').text()).toBe(t('SEW_TEST_NOTE'))
    w.unmount()
  })

  it('OCR 결과(수 비교·안 맞음·읽은 것 없음·옛 스텝): 읽은 값·신뢰도 없음·"(읽은 글 없음)"·한 줄 이상 맞으면 성공 안내', async () => {
    const input = OCR()
    const w = mountRow({ input })
    store.run = ocrDone(input, { accepted: false, lines: [], confidence: { values: [], min: null }, numeric: true, noSuffix: true })
    await w.vm.$nextTick()
    expect(at(w, 'se-test-head').text()).toBe(t('SEW_TEST_OCR_NO', { ms: 812 }))
    expect(at(w, 'se-test-head').attributes('data-ok')).toBe('false')
    expect(at(w, 'se-test-result').text()).toContain(t('SEW_TEST_OCR_READ_NUMBER'))
    expect(all(w, 'se-test-line').map((l) => l.text())).toEqual([t('SEW_TEST_OCR_EMPTY')])
    expect(at(w, 'se-test-conf').exists()).toBe(false)
    expect(at(w, 'se-test-nosuffix').text()).toBe(t('SEW_TEST_OCR_NO_SUFFIX'))
    w.unmount()
  })

  it('글자별 신뢰도는 100개까지만 보인다', async () => {
    const input = OCR()
    const w = mountRow({ input })
    store.run = ocrDone(input, { confidence: { values: Array.from({ length: 150 }, () => 90), min: 90 } })
    await w.vm.$nextTick()
    expect(at(w, 'se-test-conf').text().match(/\b90\b/g).length).toBe(101) // 가장 낮은 값 하나 + 글자별 100
    w.unmount()
  })

  it('실패: 오류 문구만 보인다(앞의 결과·색이 남지 않는다)', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = { status: 'error', kind: 'image', key: testKey(input, BASE), valueKey: valueKey(input, 0.9), screen: 'base', message: t('SEW_ERR_VISION_NO_ANSWER'), stale: false }
    await w.vm.$nextTick()
    expect(at(w, 'se-test-result').attributes('data-status')).toBe('error')
    expect(at(w, 'se-test-error').text()).toBe(t('SEW_ERR_VISION_NO_ANSWER'))
    expect(at(w, 'se-test-head').exists()).toBe(false)
    expect(all(w, 'se-test-row')).toHaveLength(0)
    expect(at(w, 'se-test-close').exists()).toBe(true)
    w.unmount()
  })

  it('값(시험 정확도)만 바뀌면 결과를 흐리게 하고 "값이 바뀌었습니다", 되돌리면 풀린다', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = imageDone(input)
    await w.vm.$nextTick()
    expect(at(w, 'se-test-stale').exists()).toBe(false)
    await type(w, 'se-test-accept', '0.8')
    expect(at(w, 'se-test-result').attributes('data-stale')).toBe('true')
    expect(at(w, 'se-test-stale').text()).toBe(t('SEW_TEST_STALE'))
    await type(w, 'se-test-accept', '0.9')
    expect(at(w, 'se-test-result').attributes('data-stale')).toBe('false')
    w.unmount()
  })

  it('스텝·영역·시험할 화면이 바뀌면 결과를 지운다', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = imageDone(input)
    await w.vm.$nextTick()
    const c = imageStep(0).condition
    await w.setProps({ input: IMAGE({ condition: { ...c, searchArea: { x: 11, y: 20, w: 300, h: 200 } } }) })
    expect(store.run.status).toBe('idle')
    expect(at(w, 'se-test-result').exists()).toBe(false)

    const moved = IMAGE({ condition: { ...c, searchArea: { x: 11, y: 20, w: 300, h: 200 } } })
    store.run = imageDone(moved)
    await w.vm.$nextTick()
    expect(at(w, 'se-test-result').exists()).toBe(true)
    showSnapshot(snap)
    snap.eqpId = 'SEWT_PHOTO_A01'
    await at(w, 'se-test-screen').setValue('snapshot')
    expect(store.run.status).toBe('idle')

    store.run = { ...imageDone(moved), key: testKey(moved, store.screenNow()), screen: 'snapshot' }
    await w.vm.$nextTick()
    expect(at(w, 'se-test-result').exists()).toBe(true)
    await w.setProps({ input: null })
    expect(store.run.status).toBe('idle')
    w.unmount()
  })

  it('다른 스텝의 결과가 남아 있어도 그리지 않는다(붙을 때 지운다)', () => {
    store.run = imageDone(IMAGE())
    const w = mountRow({ input: testInputOfDraft(imageStep(1), ctx) })
    expect(store.run.status).toBe('idle')
    expect(at(w, 'se-test-result').exists()).toBe(false)
    w.unmount()
  })

  it('시험 줄이 보이는 스텝의 영역을 저장소에 알린다(큰 화면이 스냅샷 위에 그린다) — 사라지면 비운다', async () => {
    const w = mountRow({ input: IMAGE() })
    expect(store.target).toEqual({ kind: 'image', area: { x: 10, y: 20, w: 300, h: 200 } })
    await w.setProps({ input: OCR() })
    expect(store.target).toEqual({ kind: 'ocr', area: { x: 1, y: 2, w: 30, h: 10 } })
    await w.setProps({ input: null })
    expect(store.target).toBe(null)
    await w.setProps({ input: IMAGE() })
    w.unmount()
    expect(store.target).toBe(null)
  })

  it('[닫기] 는 결과를 지우고, 시험 줄이 사라져도(다른 화면으로) 지운다', async () => {
    const input = IMAGE()
    const w = mountRow({ input })
    store.run = imageDone(input)
    await w.vm.$nextTick()
    await at(w, 'se-test-close').trigger('click')
    expect(store.run.status).toBe('idle')
    expect(at(w, 'se-test-result').exists()).toBe(false)
    store.run = imageDone(input)
    w.unmount()
    expect(store.run.status).toBe('idle')
  })
})

describe('시험 줄이 붙는 곳', () => {
  it('편집 패널: 이미지·OCR 스텝의 "찾는 것" 바로 아래에만 보인다', async () => {
    const { s } = panelFixture([imageStep(0), ocrStep(1), noneStep(2), eqpStep(3)])
    const w = mount(StepPanel, { attachTo: document.body })
    const rail = () => w.find('.se-rail').element.children
    expect(at(w, 'se-test').attributes('data-kind')).toBe('image')
    expect(rail()[1].getAttribute('data-station')).toBe('find')
    expect(rail()[2].getAttribute('data-testid')).toBe('se-test')
    expect(at(w, 'se-test').text()).toContain(t('SEW_TEST_HINT'))
    s.select('s1'); await flushPromises()
    expect(at(w, 'se-test').attributes('data-kind')).toBe('ocr')
    s.select('s2'); await flushPromises()
    expect(at(w, 'se-test').exists()).toBe(false)
    s.select('s3'); await flushPromises()
    expect(at(w, 'se-test').exists()).toBe(false)
    w.unmount()
  })

  it('편집 패널: [스텝에 넣기] 는 패널의 정확도 칸에만 넣는다 — 작업본은 [적용] 을 눌러야 바뀐다', async () => {
    const { e } = panelFixture([imageStep(0)])
    const w = mount(StepPanel, { attachTo: document.body })
    await type(w, 'se-test-accept', '0.85')
    await at(w, 'se-test-apply').trigger('click')
    expect(w.find('[data-field="accept"]').element.value).toBe('0.85')
    expect(e.panel.draft.condition.image.accept).toBe(0.85)
    expect(e.session.working.steps[0].condition.image.accept).toBe(0.9)
    expect(w.find('[data-testid="se-panel-foot"]').exists()).toBe(true) // 바뀐 것으로 잡힌다(되돌리기·적용)
    expect(at(w, 'se-test-apply').element.disabled).toBe(true) // 이제 패널 값과 같다
    w.unmount()
  })

  it('편집 패널: 패널에서 정확도를 고치면 시험 칸이 따라가고, 무엇을 시험했는지(공정·모델·시나리오·스텝 번호)를 함께 보낸다', async () => {
    panelFixture([imageStep(0), imageStep(1)])
    const start = vi.spyOn(useVisionTestStore(), 'start').mockResolvedValue(true)
    const w = mount(StepPanel, { attachTo: document.body })
    const accept = w.find('[data-field="accept"]')
    accept.element.value = '0.7'; await accept.trigger('change')
    expect(at(w, 'se-test-accept').element.value).toBe('0.70')
    await at(w, 'se-test-run').trigger('click')
    expect(start.mock.calls[0][0].accept).toBe(0.7)
    expect(start.mock.calls[0][1]).toEqual({ about: { process: 'P', model: 'M', scenario: 'N', step: 1 } })
    w.unmount()
  })

  it('편집 패널(OCR): 저장값에 다중 검사 접미사가 없던 스텝은 고치기 전에는 접미사 없이, 고치면 붙여 시험한다', async () => {
    const o = ocrStep(0)
    const old = { ...o, condition: { ...o.condition, ocr: { ...o.condition.ocr, multi: { count: '1', op: 0, raw: '' }, raw: 'IDLE' } } }
    panelFixture([old])
    const start = vi.spyOn(useVisionTestStore(), 'start').mockResolvedValue(true)
    const w = mount(StepPanel, { attachTo: document.body })
    await at(w, 'se-test-run').trigger('click')
    expect(start.mock.calls[0][0].ocr.multi).toBe(null)
    const desc = w.find('[data-field="desc"]')
    desc.element.value = '설명만 고침'; await desc.trigger('input')
    await at(w, 'se-test-run').trigger('click')
    expect(start.mock.calls[1][0].ocr.multi).toEqual({ count: 1, op: 0 })
    w.unmount()
  })

  it('편집 패널: 새 스텝도 시험한다(접미사를 붙이고, 스텝 번호는 보내지 않는다)', async () => {
    const { e } = panelFixture([ocrStep(0)])
    const start = vi.spyOn(useVisionTestStore(), 'start').mockResolvedValue(true)
    const w = mount(StepPanel, { attachTo: document.body })
    e.startNew('ocr'); await flushPromises()
    e.updateDraft((d) => ({ ...d, condition: { ...d.condition, searchArea: { x: 1, y: 2, w: 30, h: 10 }, ocr: { ...d.condition.ocr, op: 1, opName: 'TextEqual', text: 'RUN' } }, images: { ...d.images, base: { from: 'source', id: 's0-bi' } } }))
    await flushPromises()
    expect(at(w, 'se-test').attributes('data-kind')).toBe('ocr')
    await at(w, 'se-test-run').trigger('click')
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0].ocr.multi).not.toBe(null)
    expect(start.mock.calls[0][1].about.step).toBeUndefined()
    w.unmount()
  })

  it('읽기 전용 상세: 이미지·OCR 스텝에 시험 줄이 보이고("저장된 값으로") [스텝에 넣기] 는 없다', async () => {
    // 서버 뼈대의 찾을 그림에는 주소가 있다(시험 준비물의 뼈대에는 없어 여기서 넣는다)
    const c0 = imageStep(0).condition
    const skOver = { s0: { condition: { ...c0, image: { ...c0.image, trainImages: [{ key: 0, type: true, url: '/t/s0' }] } } } }
    const { s } = panelFixture([imageStep(0), ocrStep(1), noneStep(2)], { canWrite: false, skOver })
    expect(useEditStore().editable).toBe(false)
    const start = vi.spyOn(useVisionTestStore(), 'start').mockResolvedValue(true)
    const w = mount(StepDetail, { attachTo: document.body })
    expect(at(w, 'se-test').attributes('data-kind')).toBe('image')
    expect(at(w, 'se-test').text()).toContain(t('SEW_TEST_HINT_READONLY'))
    expect(at(w, 'se-test-accept').element.value).toBe('0.90')
    expect(at(w, 'se-test-apply').exists()).toBe(false)
    expect(at(w, 'se-test-run').attributes('title')).toBeUndefined()
    await at(w, 'se-test-run').trigger('click')
    expect(start.mock.calls[0][0].uid).toBe('s0')
    expect(start.mock.calls[0][1]).toEqual({ about: { process: 'P', model: 'M', scenario: 'N', step: 1 } })
    s.select('s1'); await flushPromises()
    expect(at(w, 'se-test').attributes('data-kind')).toBe('ocr')
    s.select('s2'); await flushPromises()
    expect(at(w, 'se-test').exists()).toBe(false)
    w.unmount()
  })
})
