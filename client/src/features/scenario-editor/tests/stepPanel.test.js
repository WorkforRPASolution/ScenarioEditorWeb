import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => `http://x/api${p}` }))
// 패널의 [다시 찍기]·잡기 버튼이 그림을 받으러 가지 않게(브라우저 확인은 E2E)
vi.mock('../editor/images', async (orig) => ({ ...(await orig()), loadBitmap: vi.fn(() => Promise.reject(new Error('no network in unit tests'))) }))
import StepPanel from '../components/StepPanel.vue'
import { t, MESSAGES, LABELS } from '../messages'
import { panelFixture, imageStep, ocrStep, noneStep, eqpStep } from './panelFixture'

const mountPanel = () => mount(StepPanel, { attachTo: document.body })
const errText = (w, field) => w.find(`[data-err="${field}"]`)
const input = async (w, sel, value) => { const el = w.find(sel); el.element.value = value; await el.trigger('input'); await el.trigger('change') }

describe('StepPanel — 레일과 [적용]', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('이미지 스텝: 설명·보는 곳·찾는 것·찾으면 하는 일·갈 곳·선택 구역', async () => {
    panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    expect(w.attributes('data-testid')).toBe('se-detail') // 오른쪽 칸(P1 E2E 와 같은 이름)
    expect(w.find('[data-field="desc"]').element.value).toBe('스텝0')
    expect(w.findAll('[data-station]').map((x) => x.attributes('data-station'))).toEqual(['look', 'find', 'action', 'flow', 'option'])
    expect(w.find('[data-station="look"]').text()).toContain('X10')
    expect(w.find('[data-field="accept"]').element.value).toBe('0.90')
    expect(w.find('[data-field="multi"]').element.value).toBe('1')
    expect(w.find('[data-testid="se-panel-act-now"]').text()).toContain('마우스 클릭')
    expect(w.find('[data-field="click"]').element.value).toBe('24')
    expect(w.find('[data-target="onTrue"]').text()).toContain('NEXT')
    expect(w.find('[data-target="onFalse"]').text()).toContain('FAIL')
    expect(w.find('[data-testid="se-panel-foot"]').exists()).toBe(false) // 바뀐 것이 없으면 적용 줄도 없다
    w.unmount()
  })

  it('조건 없음은 보는 곳·찾는 것이 없고 "하는 일"부터, 설비 상태는 조건 값을 보기만', () => {
    panelFixture([noneStep(0), eqpStep(1)])
    const w = mountPanel()
    expect(w.findAll('[data-station]').map((x) => x.attributes('data-station'))).toEqual(['action', 'flow', 'option'])
    expect(w.find('[data-station="action"]').text()).toContain(t('SEW_PANEL_DO_NONE'))
    w.unmount()
  })

  it('설비 상태: 대상·상태를 보이고 입력 칸이 없다', async () => {
    const { s } = panelFixture([noneStep(0), eqpStep(1)])
    s.select('s1')
    const w = mountPanel(); await flushPromises()
    const find = w.find('[data-station="find"]')
    expect(find.text()).toContain('MAIN')
    expect(find.text()).toContain('RUN')
    expect(find.findAll('input, select').length).toBe(0)
    w.unmount()
  })

  it('바뀐 값 줄 — 글의 일부만 바뀌면 그 부분만 색으로(이전 del·지금 ins), 고른 값은 색 없음', async () => {
    panelFixture([noneStep(0), noneStep(1)])
    const w = mountPanel()
    await input(w, '[data-field="desc"]', '스텝0 다시 확인')
    await input(w, '[data-station="action"] input', 'restart.bat /f')
    const foot = w.find('[data-testid="se-panel-foot"]')
    expect(foot.text()).toContain('설명 스텝0 → 스텝0 다시 확인')
    expect(foot.text()).toContain('동작 명령 실행 restart.bat → 명령 실행 restart.bat /f')
    expect(foot.findAll('del')).toHaveLength(0)
    expect(foot.findAll('ins').map((x) => x.element.textContent)).toEqual([' 다시 확인', ' /f'])
    w.unmount()
  })

  it('정확도를 고치면 적용 줄이 생기고 [적용] 으로 작업본에 들어간다', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    await input(w, '[data-field="accept"]', '0.80')
    expect(e.session.working).toBe(edited) // 아직 적용 전
    const foot = w.find('[data-testid="se-panel-foot"]')
    expect(foot.text()).toContain(t('SEW_PANEL_CHANGED_N', { n: 1 }))
    expect(foot.text()).toContain('0.90')
    await w.find('[data-testid="se-panel-apply"]').trigger('click')
    expect(e.session.working.steps[0].condition.image.accept).toBe(0.8)
    expect(e.session.working.steps[1]).toBe(edited.steps[1])
    expect(e.toast.text).toBe(t('SEW_CMD_APPLIED', { no: 1 }))
    w.unmount()
  })

  it('[되돌리기] 는 패널을 마지막 적용 값으로', async () => {
    const { e, edited } = panelFixture([imageStep(0)])
    const w = mountPanel()
    await input(w, '[data-field="desc"]', '바꾼 설명')
    await w.find('[data-testid="se-panel-revert"]').trigger('click')
    expect(e.panel.draft).toBe(edited.steps[0])
    expect(w.find('[data-field="desc"]').element.value).toBe('스텝0')
    w.unmount()
  })

  it('오류가 있으면 칸 옆에 이유, [적용] 은 작업본을 바꾸지 않고 첫 오류 칸으로 초점', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    await input(w, '[data-field="retry"]', '1')
    await input(w, '[data-field="desc"]', 'Reset @ 버튼')
    expect(errText(w, 'desc').text()).toBe(MESSAGES.RULE_STEP_DESC_CHARS)
    expect(errText(w, 'retry').text()).toBe(t('RULE_RETRY_RANGE', { max: 20 }))
    await w.find('[data-testid="se-panel-apply"]').trigger('click')
    await flushPromises()
    expect(e.session.working).toBe(edited)
    expect(document.activeElement.getAttribute('data-field')).toBe('desc')
    expect(w.find('[data-testid="se-panel-firsterr"]').text()).toContain(t('SEW_PANEL_FIX_N', { n: 2 }))
    w.unmount()
  })

  it('정확도가 숫자가 아니면 "0.5~1 사이 숫자"', async () => {
    panelFixture([imageStep(0)])
    const w = mountPanel()
    await input(w, '[data-field="accept"]', 'abc')
    expect(errText(w, 'accept').text()).toBe(MESSAGES.RULE_ACCEPT_TOO_HIGH)
    expect(MESSAGES.RULE_ACCEPT_TOO_HIGH).toContain('0.5~1 사이 숫자')
    w.unmount()
  })

  it('갈 곳을 누르면 고르기 창, 고르면 초안에 들어간다(적용 전)', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1), imageStep(2)])
    const w = mountPanel()
    await w.find('[data-target="onFalse"]').trigger('click')
    const picker = w.findComponent({ name: 'TargetPicker' })
    expect(picker.props('selfUid')).toBe('s0')
    expect(picker.props('which')).toBe('onFalse')
    picker.vm.$emit('pick', { kind: 'step', uid: 's2' })
    await flushPromises()
    expect(e.panel.draft.next.onFalse).toEqual({ kind: 'step', uid: 's2' })
    expect(e.session.working).toBe(edited)
    expect(w.find('[data-target="onFalse"]').text()).toContain('→3')
    w.unmount()
  })

  it('재시도 간격·횟수는 초·회로 고친다', async () => {
    const { e } = panelFixture([imageStep(0)])
    const w = mountPanel()
    await input(w, '[data-field="retry"]', '3')
    await input(w, '[data-testid="se-retry-n"]', '5')
    expect(e.panel.draft.retry).toEqual({ limit: 5, intervalMs: 3000 })
    w.unmount()
  })

  it('조건 종류는 바꾸지 못한다 — 종류는 글자로만 보이고, 패널의 어느 칸을 고쳐도 적용해도 condition.kind 는 그대로', async () => {
    for (const [mk, kind] of [[imageStep, 'image'], [ocrStep, 'ocr'], [noneStep, 'none']]) {
      setActivePinia(createPinia())
      const { e } = panelFixture([mk(0), imageStep(1)])
      const w = mountPanel()
      expect(w.find('[data-testid="se-panel-kind"]').text()).toBe(LABELS.condition[kind])
      expect(w.find('[data-testid="se-panel-kind"]').element.tagName).not.toMatch(/^(BUTTON|SELECT|INPUT)$/)
      await w.find('[data-testid="se-panel-act-now"]').trigger('click') // 동작 목록도 펼친다
      const root = w.find('.se-rail').element.parentElement
      for (const el of [...root.querySelectorAll('input, select')]) {
        if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')) }
        else if (el.tagName === 'SELECT') { el.selectedIndex = el.options.length - 1; el.dispatchEvent(new Event('change')) }
        else { el.value = '3'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')) }
        await flushPromises()
        expect(e.panel.draft.condition.kind, el.outerHTML.slice(0, 80)).toBe(kind)
      }
      for (const el of [...root.querySelectorAll('.se-rail button:not([data-target])')]) {
        el.click(); await flushPromises()
        expect(e.panel.draft.condition.kind, el.outerHTML.slice(0, 80)).toBe(kind)
      }
      e.updateDraft((d) => ({ ...d, descriptionToEmail: '바뀐 설명', retry: { limit: 1, intervalMs: 2000 }, action: { type: 0, typeName: 'None' } }))
      if (kind === 'image') e.updateDraft((d) => ({ ...d, condition: { ...d.condition, image: { ...d.condition.image, accept: 0.8, multi: { count: '1', op: 0 } } } }))
      if (kind === 'ocr') e.updateDraft((d) => ({ ...d, condition: { ...d.condition, searchArea: { x: 1, y: 2, w: 3, h: 4 }, ocr: { ...d.condition.ocr, op: 1, opName: 'TextEqual', text: 'A', multi: { count: '1', op: 0 } } } }))
      expect(e.applyPanel()).toBe(true)
      expect(e.session.working.steps[0].condition.kind).toBe(kind)
      w.unmount()
    }
  })

  it('전처리 스킵 체크는 초안에 들어간다', async () => {
    const { e } = panelFixture([imageStep(0)])
    const w = mountPanel()
    const box = w.find('[data-testid="se-panel-skip"]')
    box.element.checked = true
    await box.trigger('change')
    expect(e.panel.draft.condition.skipPreprocessing).toBe(true)
    w.unmount()
  })

  it('위·아래 스텝 버튼은 다른 줄로 가기(적용 안 한 변경이 있으면 묻는다)', async () => {
    const { s, e } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    expect(w.find('[data-testid="se-panel-prev"]').attributes('disabled')).toBeDefined()
    await w.find('[data-testid="se-panel-next"]').trigger('click')
    expect(s.selectedUid).toBe('s1')
    await input(w, '[data-field="desc"]', 'x')
    await w.find('[data-testid="se-panel-prev"]').trigger('click')
    expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: 's0' })
    w.unmount()
  })
})

describe('StepPanel — 안내(옛 값·보존 전용·잃는 값)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('조건 없음 + 마우스 클릭(옛 값): 안내만 보이고 칸 오류가 아니다, 스텝을 고치면 동작 칸 오류', async () => {
    panelFixture([noneStep(0, { action: { type: 1, typeName: 'MouseLeftClick', raw: '500:300', click: { x: 500, y: 300, basis: 'screenOrigin' } } })],
      { skOver: { s0: { notes: [{ level: 'warning', code: 'NONE_WITH_MOUSE_CLICK', params: {} }] } } })
    const w = mountPanel()
    expect(w.find('[data-note="none-click"]').text()).toBe(t('SEW_PANEL_NOTE_NONE_CLICK'))
    expect(errText(w, 'action').exists()).toBe(false)
    expect(w.find('[data-testid="se-panel-act-body"]').text()).toContain('500')
    await input(w, '[data-field="desc"]', '화면 깨우기')
    expect(errText(w, 'action').text()).toBe(MESSAGES.RULE_NONE_MOUSE_CLICK)
    w.unmount()
  })

  it('OCR + 마우스 클릭(옛 값)도 안내', () => {
    panelFixture([ocrStep(0, { action: { type: 1, typeName: 'MouseLeftClick', raw: '620:110', click: { x: 620, y: 110, basis: 'unknown' } } })])
    const w = mountPanel()
    expect(w.find('[data-note="ocr-click"]').text()).toBe(t('SEW_PANEL_NOTE_OCR_CLICK'))
    w.unmount()
  })

  it('보존 전용 동작: 안내와 원래 값, 고칠 수 없음', () => {
    panelFixture([noneStep(0, { action: { type: 14, typeName: 'ACS', raw: 'CALL PM TEAM' } })])
    const w = mountPanel()
    expect(w.find('[data-note="locked"]').exists()).toBe(true)
    const body = w.find('[data-testid="se-panel-act-body"]')
    expect(body.text()).toContain('CALL PM TEAM')
    expect(body.text()).toContain(t('SEW_PANEL_LOCKED_HELP'))
    expect(body.findAll('input, select, textarea').length).toBe(0)
    w.unmount()
  })

  it('실패할 수 있는 동작의 실패 쪽이 NEXT 면 안내', () => {
    panelFixture([noneStep(0, { next: { onTrue: { kind: 'next' }, onFalse: { kind: 'next' } } }), noneStep(1)])
    const w = mountPanel()
    expect(w.find('[data-note="false-next"]').text()).toBe(MESSAGES.SEW_EDIT_PICK_NEXT_WARN)
    w.unmount()
  })

  it('R-T6a: 저장된 찾을 그림 표에 옮길 수 없는 항목(정규가 아닌 키·빈 값)이 있으면 고치면 빠진다고 알린다', () => {
    const map = (m) => ({ raw: { Metadata: { ImageSearchParam: { TrainImageMap: m } } } })
    const { s } = panelFixture([imageStep(0), imageStep(1), imageStep(2), ocrStep(3)], {
      skOver: { s0: map({ 0: { BinaryImage: '/x', Type: true }, '-1': { BinaryImage: 'AA', Type: true } }), s1: map({ 0: { BinaryImage: '/x', Type: true }, 1: null }), s3: map({ '-1': {} }) }
    })
    let w = mountPanel()
    expect(w.find('[data-note="train-dropped"]').text()).toBe(t('SEW_PANEL_NOTE_TRAIN_DROPPED'))
    w.unmount()
    s.select('s1'); w = mountPanel()
    expect(w.find('[data-note="train-dropped"]').exists()).toBe(true)
    w.unmount()
    s.select('s2'); w = mountPanel()
    expect(w.find('[data-note="train-dropped"]').exists()).toBe(false)
    w.unmount()
    s.select('s3'); w = mountPanel() // 이미지 스텝만(이미지가 아니면 조립이 그 표를 그대로 둔다)
    expect(w.find('[data-note="train-dropped"]').exists()).toBe(false)
    w.unmount()
  })

  it('R-T6a: 키보드 저장 값에 해석 못 한 토큰이 있으면(서버 PARSE_FAILED keyboard) 고치면 빠진다고 알린다', () => {
    const kb = { type: 5, typeName: 'Keyboard', raw: 'a@@b', keyboard: { text: 'a', keys: [], unknownCodes: [], codes: [] } }
    const { s } = panelFixture([noneStep(0, { action: kb }), noneStep(1, { action: { ...kb, raw: 'a@@10', keyboard: { text: 'a', keys: [{ code: 10, name: 'Enter' }], unknownCodes: [], codes: [10] } } })], {
      skOver: { s0: { notes: [{ level: 'warning', code: 'PARSE_FAILED', params: { field: 'keyboard', raw: 'a@@b' } }] } }
    })
    let w = mountPanel()
    expect(w.find('[data-note="key-dropped"]').text()).toBe(t('SEW_PANEL_NOTE_KEY_DROPPED'))
    w.unmount()
    s.select('s1'); w = mountPanel()
    expect(w.find('[data-note="key-dropped"]').exists()).toBe(false)
    w.unmount()
  })

  it('서버 알림(닿지 않는 스텝 등)은 패널에도 보인다', () => {
    panelFixture([imageStep(0), imageStep(1)], { skOver: { s0: { notes: [{ level: 'warning', code: 'UNREACHABLE', params: {} }] } } })
    const w = mountPanel()
    expect(w.text()).toContain(MESSAGES.SEW_NOTE_UNREACHABLE)
    w.unmount()
  })

  it('자세히: 사내 화면에 안 보이던 값과 원본 JSON', () => {
    panelFixture([imageStep(0)])
    const w = mountPanel()
    const det = w.find('[data-station="option"] details')
    expect(det.text()).toContain('MaximumNumberToFind')
    expect(det.text()).toContain('24:12')
    w.unmount()
  })
})

describe('StepPanel — 다른 시나리오에서 붙인 스텝(Task 8)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const OTHER = { from: 'other', process: 'P', model: 'M', name: 'A', crtime: 1, fileId: 'F' }
  const GONE = '원래 시나리오의 그 버전을 찾지 못했습니다'
  const pasted = (over) => imageStep(1, { uid: 'p1', origin: null, ...over })

  it('미해결 갈 곳: "미해결 7"·"원래 7번 · 눌러서 고르세요", 칸 오류 "갈 곳을 고르세요(원래 7번)." — 고를 때까지 [적용]이 막힌다', async () => {
    const { s, e, edited } = panelFixture([imageStep(0), pasted({ next: { onTrue: { kind: 'next' }, onFalse: { kind: 'unresolved', value: 7 } } }), noneStep(2)])
    s.select('p1')
    const w = mountPanel(); await flushPromises()
    const btn = w.find('[data-target="onFalse"]')
    expect(btn.text()).toContain(t('SEW_EDIT_UNRESOLVED_FROM', { value: 7 }))
    expect(btn.text()).toContain('원래 7번 · 눌러서 고르세요')
    expect(btn.classes()).toContain('border-red-500')
    expect(errText(w, 'onFalse').text()).toBe('갈 곳을 고르세요(원래 7번).')
    await input(w, '[data-field="desc"]', '붙여 온 스텝')
    expect(w.find('[data-testid="se-panel-foot"]').text()).toContain('갈 곳을 고르세요(원래 7번).')
    await w.find('[data-testid="se-panel-apply"]').trigger('click')
    expect(e.session.working).toBe(edited)
    expect(e.focusReq.field).toBe('onFalse')
    await btn.trigger('click')
    w.findComponent({ name: 'TargetPicker' }).vm.$emit('pick', { kind: 'step', uid: 's0' })
    await flushPromises()
    expect(errText(w, 'onFalse').exists()).toBe(false)
    await w.find('[data-testid="se-panel-apply"]').trigger('click')
    expect(e.session.working.steps[1].next.onFalse).toEqual({ kind: 'step', uid: 's0' })
    w.unmount()
  })

  it('원래 번호를 모르는 미해결(복사할 때 이미 없던 스텝)은 "갈 곳을 고르세요" 만 — "원래 N번" 없이', async () => {
    const { s } = panelFixture([imageStep(0), pasted({ next: { onTrue: { kind: 'unresolved' }, onFalse: { kind: 'end', value: 'FAIL' } } })])
    s.select('p1')
    const w = mountPanel(); await flushPromises()
    const btn = w.find('[data-target="onTrue"]')
    expect(btn.text()).toContain(t('SEW_EDIT_UNRESOLVED'))
    expect(btn.text()).toContain(t('SEW_PANEL_TARGET_PICK'))
    expect(btn.text()).not.toContain('원래')
    expect(errText(w, 'onTrue').text()).toBe('갈 곳을 고르세요.')
    w.unmount()
  })

  it('다른 판 그림을 불러오지 못하면(404) 그림 자리에 "원래 시나리오의 그 버전을 찾지 못했습니다" — 기준 판 그림은 P1 처럼 "없음"', async () => {
    const images = { train: { 0: { ...OTHER, id: 's1-train-0' } }, base: { ...OTHER, id: 's1-bi' } }
    const { s } = panelFixture([imageStep(0), pasted({ images })])
    s.select('p1')
    const w = mountPanel(); await flushPromises()
    const pics = () => [...w.findAll('[data-station="look"] img'), ...w.findAll('[data-station="find"] img')]
    const imgs = pics()
    expect(imgs).toHaveLength(3) // 기준 화면·검색 영역·찾을 그림
    expect(imgs[0].attributes('src')).toContain('/scenario-editor/scenarios/P/M/A/versions/1/files/F/images/s1-bi')
    for (const i of imgs) await i.trigger('error')
    expect(w.find('[data-station="look"]').text().split(GONE)).toHaveLength(3) // 두 칸 모두
    expect(w.find('[data-station="find"]').text()).toContain(GONE)
    s.select('s0')
    await flushPromises()
    for (const i of pics()) await i.trigger('error')
    expect(w.find('[data-station="look"]').text()).not.toContain(GONE)
    expect(w.find('[data-station="look"]').text()).toContain('없음')
    w.unmount()
  })
})

import CropView from '../components/CropView.vue'
import { spotKey } from '../editor/trainView'
import { SPOT_DELAY_MS } from '../composables/useTrainSpot'
describe('StepPanel — 찾을 그림 밖 누를 곳(A·B, 2026-11-08)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const url = (id) => `http://x/api/scenario-editor/scenarios/P/M/N/versions/1/files/F/images/${id}`
  const settle = async () => { await new Promise((r) => setTimeout(r, SPOT_DELAY_MS + 10)); await flushPromises() }
  const at = (x, y) => ({ type: 1, typeName: 'MouseLeftClick', raw: `${x}:${y}`, click: { x, y, basis: 'trainImage' } })
  const KEY = spotKey({ baseUrl: url('s0-bi'), trainUrl: url('s0-train-0'), area: { x: 10, y: 20, w: 300, h: 200 } })
  async function open(step) {
    const f = panelFixture([step, imageStep(1)])
    const w = mountPanel()
    const crop = w.find('[data-station="find"]').findComponent(CropView)
    crop.vm.onLoad({ target: { naturalWidth: 255, naturalHeight: 96 } })
    await flushPromises()
    return { ...f, w, crop }
  }
  const note = (w) => w.find('[data-testid="se-train-outside"]')

  it('그림 밖이면 썸네일을 넓혀 + 를 그리고 아래에 "누를 곳: 찾을 그림 밖 (X, Y)" — 위치 찾기 결과마다 주변 화면 이유', async () => {
    const { e, w, crop } = await open(imageStep(0, { action: at(300, 12) }))
    expect(crop.attributes('data-expand')).toBe('empty')
    expect(crop.find('[data-testid="se-click-marker"]').exists()).toBe(true)
    expect(note(w).text()).toBe(t('SEW_PANEL_TRAIN_OUTSIDE', { x: 300, y: 12 })) // 찾는 중
    expect(w.find('[data-station="action"]').text()).toContain(t('SEW_PANEL_CLICK_HELP_OUT'))
    await settle() // 단위 시험은 그림을 받지 못한다 → 불러오기 실패
    expect(note(w).text()).toContain(t('SEW_UI_SPOT_error'))
    expect(crop.attributes('data-expand')).toBe('empty')
    e.spots = new Map([[KEY, { found: 'many' }]])
    await flushPromises()
    expect(note(w).text()).toContain(t('SEW_UI_SPOT_many'))
    expect(crop.props('around')).toBe(null)
    e.spots = new Map([[KEY, { found: 'one', x: 711, y: 660, w: 255, h: 96, bw: 1920, bh: 1200 }]])
    await flushPromises()
    expect(note(w).text()).toContain(t('SEW_UI_SPOT_one'))
    expect(crop.props('around')).toEqual({ src: url('s0-bi'), x: 711, y: 660, bw: 1920, bh: 1200 })
    expect(crop.attributes('data-expand')).toBe('base')
    w.unmount()
  })
  it('그림 안이면 지금과 같다 — 넓히지 않고 아래 문구도 없다(찾은 결과가 있어도)', async () => {
    const { e, w, crop } = await open(imageStep(0))
    e.spots = new Map([[KEY, { found: 'one', x: 711, y: 660, w: 255, h: 96, bw: 1920, bh: 1200 }]])
    await flushPromises()
    expect(crop.attributes('data-expand')).toBeUndefined()
    expect(crop.attributes('style')).toContain('width: 110px')
    expect(note(w).exists()).toBe(false)
    w.unmount()
  })
  it('누를 곳 X 를 그림 너비보다 크게 고치면 그 자리에서 넓어지고, 작업본은 [적용] 전까지 그대로', async () => {
    const { w, crop, edited, e } = await open(imageStep(0))
    await input(w, '[data-field="click"]', '400')
    expect(crop.attributes('data-expand')).toBe('empty')
    expect(note(w).text()).toContain(t('SEW_PANEL_TRAIN_OUTSIDE', { x: 400, y: 12 }))
    expect(e.session.working).toBe(edited)
    w.unmount()
  })
  it('검색 영역이 없어 위치를 찾을 수 없는 스텝은 "주변 화면: 저장되어 있지 않음"', async () => {
    const st = imageStep(0, { action: at(-30, 5) })
    const { w } = await open({ ...st, condition: { ...st.condition, searchArea: null } })
    expect(note(w).text()).toContain(t('SEW_UI_SPOT_NOT_STORED'))
    w.unmount()
  })
})
