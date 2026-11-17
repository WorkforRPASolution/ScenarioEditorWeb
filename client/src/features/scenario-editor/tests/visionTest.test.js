// Vision·OCR 시험의 화면 규칙(P4 설계 §4) — 입력 꺼내기·꺼진 까닭·조각 사각형·좌표 보정·누를 곳·스텝 조건 판정·OCR meta·시험 입력 키
import { describe, it, expect, vi } from 'vitest'
vi.mock('../api', () => ({ imageUrl: (p) => `http://x/api${p}` }))
import {
  testInputOfDraft, testInputOfStep, acceptOf, acceptWarn, blockReason, cropOf, tooSmall, toScreen, clickOf, visionVerdict, ocrMeta,
  testKey, valueKey, ocrLines, confidenceOf, aboutOf, hitsOf
} from '../editor/visionTest'
import { imageStep, ocrStep, noneStep, eqpStep } from './panelFixture'
import { MESSAGES } from '../messages'

const session = { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' } }
const ctx = { session, uploads: new Map(), draftId: null }
const BASE = { kind: 'base' }
const SNAP = { kind: 'snapshot', snapshot: { eqpId: 'E1', fileName: '1700000000000_[1][2].png' } }

describe('영역 칸에 잘못 친 글자가 남아 있으면 시험하지 않는다(areaTyped — 칸에 보이는 값과 다른 영역으로 시험하지 않게)', () => {
  it('시험 입력에 표시가 실리고 [시험] 이 꺼지는 까닭이 된다', () => {
    const s = imageStep(0)
    const typed = { ...s, condition: { ...s.condition, areaTyped: { w: '80o' } } }
    expect(testInputOfDraft(typed, ctx).areaTyped).toBe(true)
    expect('areaTyped' in testInputOfDraft(s, ctx)).toBe(false)
    expect(blockReason(testInputOfDraft(typed, ctx), { screen: { kind: 'base' }, accept: 0.9 })).toBe('SEW_TEST_WHY_AREA_TYPED')
    expect(blockReason(testInputOfDraft(s, ctx), { screen: { kind: 'base' }, accept: 0.9 })).toBe(null)
    expect(MESSAGES.SEW_TEST_WHY_AREA_TYPED).toBeTruthy()
  })
})

describe('testInputOfDraft — 패널 초안에서 시험 입력', () => {
  it('이미지 스텝: 영역·기준 화면·찾을 그림(0번)·패널 정확도·누를 곳·동작·다중 검사', () => {
    const input = testInputOfDraft(imageStep(0), ctx)
    expect(input).toEqual({
      kind: 'image', uid: 's0', area: { x: 10, y: 20, w: 300, h: 200 },
      baseUrl: expect.stringContaining('/images/s0-bi'), trainUrl: expect.stringContaining('/images/s0-train-0'),
      accept: 0.9, click: { x: 24, y: 12 }, actionType: 1, multi: { count: 1, op: 0 }, ocr: null
    })
  })
  it('이미지 다중 검사: 저장값에 조건이 없던(TextValue 가 빈) 스텝은 고치지 않은 동안 조건 없음 — 고치면 서버가 `1-0` 을 써 넣는다', () => {
    const old = (over = {}) => { const st = imageStep(0, over); st.condition = { ...st.condition, image: { ...st.condition.image, multi: { count: '1', op: 0, raw: '' } } }; return st }
    const source = old()
    expect(testInputOfDraft(old(), ctx, source).multi).toBeNull() // 손대지 않음 → 실행은 하나 이상이면 성공
    expect(testInputOfDraft(old({ descriptionToEmail: '고침' }), ctx, source).multi).toEqual({ count: 1, op: 0 })
    expect(testInputOfDraft(old(), ctx, null).multi).toEqual({ count: 1, op: 0 }) // 새 스텝
    const stored = imageStep(0)
    expect(testInputOfDraft(stored, ctx, stored).multi).toEqual({ count: 1, op: 0 }) // 저장값에 조건이 있다
  })
  it('마우스 클릭이 아니어도 시험 입력이 된다 — 누를 곳만 없다', () => {
    const none = testInputOfDraft(imageStep(0, { action: { type: 0, typeName: 'None', raw: '' } }), ctx)
    expect([none.click, none.actionType]).toEqual([null, 0])
    const kb = testInputOfDraft(imageStep(0, { action: { type: 5, typeName: 'Keyboard', raw: 'A' } }), ctx)
    expect(kb.click).toBeNull()
    // 누를 곳이 정수가 아니거나 화면 기준이면 그리지 않는다
    expect(testInputOfDraft(imageStep(0, { action: { type: 1, click: { x: null, y: 3, basis: 'trainImage' } } }), ctx).click).toBeNull()
    expect(testInputOfDraft(imageStep(0, { action: { type: 1, click: { x: 1, y: 3, basis: 'screenOrigin' } } }), ctx).click).toBeNull()
  })
  it('찾을 그림은 가장 작은 키, 영역·그림·기준 화면이 없으면 그 칸이 null', () => {
    const two = imageStep(0, { images: { train: { 2: { from: 'source', id: 'two' }, 0: { from: 'source', id: 'zero' } }, base: { from: 'source', id: 'b' } } })
    expect(testInputOfDraft(two, ctx).trainUrl).toContain('/images/zero')
    const bare = imageStep(0, { images: { train: {}, base: { literal: 'AA==' } } })
    bare.condition.searchArea = null
    expect(testInputOfDraft(bare, ctx)).toMatchObject({ area: null, baseUrl: null, trainUrl: null })
  })
  it('정확도·다중 검사가 틀린 값이면 null(시험 칸이 따로 본다)', () => {
    const st = imageStep(0)
    st.condition.image = { ...st.condition.image, accept: '0.x', multi: { count: 'abc', op: 0, raw: '' } }
    expect(testInputOfDraft(st, ctx)).toMatchObject({ accept: null, multi: null })
  })
  it('OCR 스텝: 비교 방법·값·다중 검사', () => {
    expect(testInputOfDraft(ocrStep(1), ctx)).toEqual({
      kind: 'ocr', uid: 's1', area: { x: 1, y: 2, w: 30, h: 10 }, baseUrl: expect.stringContaining('/images/s1-bi'), trainUrl: null,
      accept: null, click: null, actionType: 0, multi: null,
      ocr: { op: 1, text: 'IDLE', number: 0, min: 0, max: 0, multi: { count: 1, op: 0 }, multiBad: false }
    })
  })
  it('조건 없음·설비 상태·없는 초안은 null', () => {
    expect(testInputOfDraft(noneStep(0), ctx)).toBeNull()
    expect(testInputOfDraft(eqpStep(0), ctx)).toBeNull()
    expect(testInputOfDraft(null, ctx)).toBeNull()
  })
})

describe('OCR 다중 검사 접미사를 붙이는가 — 배포될 값과 같게', () => {
  const old = (over = {}) => {
    const st = ocrStep(1)
    st.condition.ocr = { ...st.condition.ocr, multi: { count: '1', op: 0, raw: '' }, raw: 'IDLE', ...over }
    return st
  }
  it('저장값에 접미사가 없고 스텝이 출처 그대로면 붙이지 않는다', () => {
    const st = old()
    expect(testInputOfDraft(st, ctx, st).ocr.multi).toBeNull()
    expect(testInputOfDraft(st, ctx, JSON.parse(JSON.stringify(st))).ocr.multi).toBeNull()
  })
  it('스텝의 어디든 고쳤으면 붙인다(서버가 고친 스텝을 통째로 다시 조립한다) — 설명만 고쳐도', () => {
    const source = old()
    expect(testInputOfDraft({ ...source, descriptionToEmail: '고침' }, ctx, source).ocr.multi).toEqual({ count: 1, op: 0 })
    expect(testInputOfDraft(old({ text: 'RUN' }), ctx, source).ocr.multi).toEqual({ count: 1, op: 0 })
  })
  it('새 스텝(출처 스텝 없음)에는 붙인다. 저장값에 접미사가 있으면 그대로 붙인다', () => {
    expect(testInputOfDraft(old(), ctx, null).ocr.multi).toEqual({ count: 1, op: 0 })
    const st = ocrStep(1)
    expect(testInputOfDraft(st, ctx, st).ocr.multi).toEqual({ count: 1, op: 0 })
  })
  it('붙일 다중 검사 값이 틀리면 multiBad', () => {
    const st = ocrStep(1)
    st.condition.ocr = { ...st.condition.ocr, multi: { count: '21', op: 0, raw: '21-0' } }
    expect(testInputOfDraft(st, ctx, null).ocr).toMatchObject({ multi: null, multiBad: true })
    st.condition.ocr = { ...st.condition.ocr, multi: { count: '2', op: null, raw: '2-x' } }
    expect(testInputOfDraft(st, ctx, null).ocr).toMatchObject({ multi: null, multiBad: true })
  })
})

describe('testInputOfStep — 읽기 전용의 표시 스텝에서 시험 입력', () => {
  const shown = (st, over = {}) => ({ ...st, no: 1, notes: [], baseImage: { state: 'present', url: '/b' }, ...over })
  it('이미지 스텝: 기준 화면·찾을 그림 URL 은 표시 스텝의 것', () => {
    const st = shown(imageStep(0))
    st.condition = { ...st.condition, image: { ...st.condition.image, trainImages: [{ key: 1, url: '/t1' }, { key: 0, url: '/t0' }] } }
    expect(testInputOfStep(st)).toEqual({
      kind: 'image', uid: 's0', area: { x: 10, y: 20, w: 300, h: 200 }, baseUrl: 'http://x/api/b', trainUrl: 'http://x/api/t0',
      accept: 0.9, click: { x: 24, y: 12 }, actionType: 1, multi: { count: 1, op: 0 }, ocr: null
    })
  })
  it('이미지 다중 검사: 저장값(multi.raw)에 조건이 있을 때만 싣는다', () => {
    const old = shown(imageStep(0))
    old.condition = { ...old.condition, image: { ...old.condition.image, multi: { count: '1', op: 0, raw: '' } } }
    expect(testInputOfStep(old).multi).toBeNull()
    expect(testInputOfStep(shown(imageStep(0))).multi).toEqual({ count: 1, op: 0 })
  })
  it('기준 화면이 없으면 baseUrl 이 null — 스냅샷으로는 시험할 수 있다', () => {
    expect(testInputOfStep(shown(imageStep(0), { baseImage: { state: 'missing' } })).baseUrl).toBeNull()
  })
  it('OCR: 저장값(multi.raw)에 접미사가 있을 때만 다중 검사를 싣는다', () => {
    expect(testInputOfStep(shown(ocrStep(1))).ocr.multi).toEqual({ count: 1, op: 0 })
    const old = shown(ocrStep(1))
    old.condition = { ...old.condition, ocr: { ...old.condition.ocr, multi: { count: '1', op: 0, raw: '' } } }
    expect(testInputOfStep(old).ocr).toMatchObject({ multi: null, multiBad: false })
  })
  it('조건 없음·없는 스텝은 null', () => {
    expect(testInputOfStep(shown(noneStep(0)))).toBeNull()
    expect(testInputOfStep(null)).toBeNull()
  })
})

describe('시험 정확도 칸', () => {
  it('0~1 의 수만 받는다(앞뒤 빈칸은 지운다)', () => {
    expect([acceptOf('0.9'), acceptOf(' 1 '), acceptOf('0'), acceptOf('.5'), acceptOf(0.75)]).toEqual([0.9, 1, 0, 0.5, 0.75])
    for (const bad of ['', 'abc', '1.01', '-0.1', '0.9a', '1e-1', null, undefined, NaN]) expect(acceptOf(bad), String(bad)).toBeNull()
  })
  it('0.5 미만이면 경고(저장할 수 없는 값)', () => {
    expect([acceptWarn(0.49), acceptWarn(0.5), acceptWarn(null)]).toEqual([true, false, false])
  })
})

describe('blockReason — [시험] 이 꺼지는 까닭', () => {
  const image = testInputOfDraft(imageStep(0), ctx)
  const ocr = testInputOfDraft(ocrStep(1), ctx, null)
  it('다 맞으면 null', () => {
    expect(blockReason(image, { screen: BASE, accept: 0.9, running: false })).toBeNull()
    expect(blockReason(ocr, { screen: BASE, running: false })).toBeNull()
    expect(blockReason({ ...image, baseUrl: null }, { screen: SNAP, accept: 0.9, running: false })).toBeNull()
  })
  it('시험 중 · 영역 없음 · 찾을 그림 없음 · 정확도 틀림', () => {
    expect(blockReason(image, { screen: BASE, accept: 0.9, running: true })).toBe('SEW_TEST_WHY_RUNNING')
    expect(blockReason({ ...image, area: null }, { screen: BASE, accept: 0.9 })).toBe('SEW_TEST_WHY_NO_AREA')
    expect(blockReason({ ...image, trainUrl: null }, { screen: BASE, accept: 0.9 })).toBe('SEW_TEST_WHY_NO_TRAIN')
    expect(blockReason(image, { screen: BASE, accept: null })).toBe('SEW_TEST_WHY_ACCEPT')
  })
  it('시험할 화면이 없음 — 기준 화면이 없거나, 스냅샷을 골랐는데 떠 있는 스냅샷이 없다', () => {
    expect(blockReason({ ...image, baseUrl: null }, { screen: BASE, accept: 0.9 })).toBe('SEW_TEST_WHY_NO_BASE')
    expect(blockReason(image, { screen: { kind: 'snapshot', snapshot: null }, accept: 0.9 })).toBe('SEW_TEST_WHY_NO_SNAPSHOT')
  })
  it('OCR: 비교 방법 없음 · 값이 패널 검사에 걸림(빈 글·@@@@·@ 로 끝남·수 아님·범위 한쪽) · 다중 검사 틀림', () => {
    const o = (over) => ({ ...ocr, ocr: { ...ocr.ocr, ...over } })
    expect(blockReason(o({ op: 0 }), { screen: BASE })).toBe('SEW_TEST_WHY_OCR_OP')
    for (const text of ['', 'A@@@@B', 'AB@', 5, null]) expect(blockReason(o({ op: 3, text }), { screen: BASE }), String(text)).toBe('SEW_TEST_WHY_OCR_VALUE')
    expect(blockReason(o({ op: 5, number: null }), { screen: BASE })).toBe('SEW_TEST_WHY_OCR_VALUE')
    expect(blockReason(o({ op: 7, min: 1, max: null }), { screen: BASE })).toBe('SEW_TEST_WHY_OCR_VALUE')
    expect(blockReason(o({ op: 7, min: 1, max: 2 }), { screen: BASE })).toBeNull()
    expect(blockReason(o({ multi: null, multiBad: true }), { screen: BASE })).toBe('SEW_TEST_WHY_OCR_MULTI')
  })
})

describe('조각 사각형과 좌표', () => {
  it('cropOf: 검색 영역을 시험할 화면 안쪽으로 자른다 — 통째로 밖이면 null', () => {
    expect(cropOf({ x: 10, y: 20, w: 300, h: 200 }, { w: 1920, h: 1200 })).toEqual({ x: 10, y: 20, w: 300, h: 200 })
    expect(cropOf({ x: 500, y: 300, w: 300, h: 200 }, { w: 640, h: 360 })).toEqual({ x: 500, y: 300, w: 140, h: 60 })
    expect(cropOf({ x: -20, y: -10, w: 100, h: 50 }, { w: 640, h: 360 })).toEqual({ x: 0, y: 0, w: 80, h: 40 })
    expect(cropOf({ x: 700, y: 20, w: 100, h: 50 }, { w: 640, h: 360 })).toBeNull()
  })
  it('tooSmall: 조각이 찾을 그림보다 작으면 보내지 않는다', () => {
    expect(tooSmall({ w: 140, h: 60 }, { w: 255, h: 96 })).toBe(true)
    expect(tooSmall({ w: 255, h: 96 }, { w: 255, h: 96 })).toBe(false)
    expect(tooSmall({ w: 300, h: 95 }, { w: 255, h: 96 })).toBe(true)
  })
  it('toScreen: 받은 좌표의 소수를 버리고 **자른 조각의 왼쪽 위**를 더한다(영역 X·Y 가 아니다)', () => {
    const crop = { x: 0, y: 0, w: 80, h: 40 } // 영역은 (-20, -10) 이었다
    expect(toScreen([{ score: 0.9731, x: 12.9, y: 40.2 }, { score: 1, x: 0, y: 0 }], crop)).toEqual([{ score: 0.9731, x: 12, y: 40 }, { score: 1, x: 0, y: 0 }])
    expect(toScreen([{ score: 0.9, x: 96.75, y: 30 }], { x: 500, y: 300, w: 140, h: 60 })).toEqual([{ score: 0.9, x: 596, y: 330 }])
  })
  it('clickOf: 첫 결과의 왼쪽 위 + 스텝의 상대 좌표(그림 밖·음수도 그대로) — 누를 곳이 없는 스텝은 null', () => {
    const image = testInputOfDraft(imageStep(0), ctx)
    expect(clickOf(image, { x: 596, y: 330 })).toEqual({ x: 620, y: 342 })
    expect(clickOf({ ...image, click: { x: -3, y: 400 } }, { x: 10, y: 10 })).toEqual({ x: 7, y: 410 })
    expect(clickOf({ ...image, click: null }, { x: 10, y: 10 })).toBeNull()
    expect(clickOf(image, undefined)).toBeNull()
  })
})

describe('visionVerdict — 스텝의 조건으로 맞음·안 맞음', () => {
  const image = testInputOfDraft(imageStep(0), ctx)
  const multi = (count, op) => ({ ...image, actionType: 0, click: null, multi: { count, op } })
  it('동작이 있으면(마우스 클릭 등) 하나 이상 찾으면 맞음 — 다중 검사 값은 보지 않는다', () => {
    expect(visionVerdict(image, 0)).toEqual({ ok: false, rule: null })
    expect(visionVerdict(image, 1)).toEqual({ ok: true, rule: null })
    expect(visionVerdict({ ...image, multi: { count: 3, op: 0 } }, 1)).toEqual({ ok: true, rule: null })
  })
  it('동작이 없고 다중 검사가 있으면 그 조건: 0 같음 · 1 이상 · 2 이하', () => {
    expect([1, 2, 3].map((n) => visionVerdict(multi(2, 0), n).ok)).toEqual([false, true, false])
    expect([1, 2, 3].map((n) => visionVerdict(multi(2, 1), n).ok)).toEqual([false, true, true])
    expect([1, 2, 3].map((n) => visionVerdict(multi(2, 2), n).ok)).toEqual([true, true, false])
    expect(visionVerdict(multi(2, 1), 3).rule).toEqual({ count: 2, op: 1 })
    // 실행은 먼저 하나 이상 찾아야 하고 그다음에 개수 조건을 본다 — 0곳은 "n개 이하" 여도 실패다
    expect(visionVerdict(multi(2, 2), 0)).toEqual({ ok: false, rule: { count: 2, op: 2 } })
    expect(visionVerdict(multi(1, 1), 0).ok).toBe(false)
  })
  it('동작이 없는데 다중 검사 값을 읽지 못하면 하나 이상', () => {
    expect(visionVerdict({ ...image, actionType: 0, multi: null }, 1)).toEqual({ ok: true, rule: null })
  })
})

describe('ocrMeta — 서버에 보낼 meta', () => {
  const ocr = testInputOfDraft(ocrStep(1), ctx, null)
  const o = (over) => ({ ...ocr, ocr: { ...ocr.ocr, ...over } })
  it('연산에 맞는 칸만 싣는다 — 다중 검사 개수는 정수', () => {
    expect(ocrMeta(ocr)).toEqual({ op: 1, text: 'IDLE', multi: { count: 1, op: 0 } })
    expect(ocrMeta(o({ op: 9, number: 12.5, multi: { count: 0, op: 2 } }))).toEqual({ op: 9, number: 12.5, multi: { count: 0, op: 2 } })
    expect(ocrMeta(o({ op: 8, min: 10, max: 20, multi: null }))).toEqual({ op: 8, min: 10, max: 20 })
  })
})

describe('시험 입력 키', () => {
  const image = testInputOfDraft(imageStep(0), ctx)
  it('testKey: 스텝·시험할 화면의 그림·찾을 그림·영역 — 하나라도 달라지면 다른 키', () => {
    const k = testKey(image, BASE)
    expect(testKey(testInputOfDraft(imageStep(0), ctx), BASE)).toBe(k)
    expect(testKey({ ...image, uid: 's9' }, BASE)).not.toBe(k)
    expect(testKey({ ...image, baseUrl: 'blob:other' }, BASE)).not.toBe(k)
    expect(testKey({ ...image, trainUrl: 'blob:t2' }, BASE)).not.toBe(k)
    expect(testKey({ ...image, area: { ...image.area, w: 301 } }, BASE)).not.toBe(k)
    expect(testKey(image, SNAP)).not.toBe(k)
    expect(testKey(image, { kind: 'snapshot', snapshot: { eqpId: 'E1', fileName: 'other.png' } })).not.toBe(testKey(image, SNAP))
    expect(testKey(null, BASE)).toBeNull()
  })
  it('스냅샷으로 시험할 때는 기준 화면이 바뀌어도 같은 키', () => {
    expect(testKey({ ...image, baseUrl: 'blob:other' }, SNAP)).toBe(testKey(image, SNAP))
  })
  it('valueKey: 정확도·누를 곳·동작·다중 검사(이미지), 비교 방법·값·다중 검사(OCR) — 키에는 들지 않는다', () => {
    expect(valueKey(image, 0.9)).not.toBe(valueKey(image, 0.85))
    expect(valueKey(image, 0.9)).not.toBe(valueKey({ ...image, click: { x: 1, y: 1 } }, 0.9))
    expect(valueKey(image, 0.9)).toBe(valueKey({ ...image }, 0.9))
    const ocr = testInputOfDraft(ocrStep(1), ctx, null)
    expect(valueKey(ocr)).not.toBe(valueKey({ ...ocr, ocr: { ...ocr.ocr, text: 'RUN' } }))
    expect(testKey(ocr, BASE)).toBe(testKey({ ...ocr, ocr: { ...ocr.ocr, text: 'RUN' } }, BASE))
  })
})

describe('OCR 결과 읽기', () => {
  it('ocrLines: " @@ " 로 나눈 줄 — 빈 글이면 빈 목록', () => {
    expect(ocrLines('READY @@ READY 2 @@ IDLE')).toEqual(['READY', 'READY 2', 'IDLE'])
    expect(ocrLines('')).toEqual([])
    expect(ocrLines('A@@B')).toEqual(['A@@B'])
  })
  it('confidenceOf: ":<정수>" 들과 가장 낮은 값 — 빈 글(수 비교)은 없음', () => {
    expect(confidenceOf(':98:71:100')).toEqual({ values: [98, 71, 100], min: 71 })
    expect(confidenceOf('')).toEqual({ values: [], min: null })
    expect(confidenceOf('garbage')).toEqual({ values: [], min: null })
  })
})

describe('aboutOf — 로그에 남길 "무엇을 시험했는지"', () => {
  it('공정·모델·시나리오·스텝 번호', () => {
    expect(aboutOf({ process: 'P', model: 'M', name: 'N' }, 3)).toEqual({ process: 'P', model: 'M', scenario: 'N', step: 3 })
    expect(aboutOf(null, 0)).toEqual({})
    expect(aboutOf({ process: 'P' }, null)).toEqual({ process: 'P' })
  })
})

describe('hitsOf — 큰 화면에 겹쳐 그릴 찾은 곳', () => {
  const done = { status: 'done', kind: 'image', screen: 'base', results: [{ score: 1, x: 96, y: 150 }, { score: 0.9, x: 96, y: 206 }], train: { w: 255, h: 96 }, click: { x: 120, y: 162 }, picked: 1, stale: false }
  it('찾은 곳마다 찾을 그림 크기의 사각형(왼쪽 위 = 결과 좌표)·고른 줄·첫 결과의 누를 곳', () => {
    expect(hitsOf(done, 'step')).toEqual({
      rects: [{ no: 1, x: 96, y: 150, w: 255, h: 96, picked: false }, { no: 2, x: 96, y: 206, w: 255, h: 96, picked: true }],
      click: { x: 120, y: 162 }, stale: false
    })
    expect(hitsOf({ ...done, click: null, stale: true }, 'step')).toMatchObject({ click: null, stale: true })
  })
  it('시험한 화면의 모드에서만: 기준 화면 → 스텝 그림, 지금 스냅샷 → 스냅샷', () => {
    expect(hitsOf(done, 'snapshot')).toBe(null)
    expect(hitsOf({ ...done, screen: 'snapshot' }, 'snapshot')).not.toBe(null)
    expect(hitsOf({ ...done, screen: 'snapshot' }, 'step')).toBe(null)
  })
  it('결과가 없으면(시험 전·시험 중·실패·OCR·0건) 그리지 않는다', () => {
    expect(hitsOf({ status: 'idle' }, 'step')).toBe(null)
    expect(hitsOf({ status: 'running', kind: 'image', screen: 'base' }, 'step')).toBe(null)
    expect(hitsOf({ status: 'error', kind: 'image', screen: 'base', message: 'x' }, 'step')).toBe(null)
    expect(hitsOf({ status: 'done', kind: 'ocr', screen: 'base', accepted: true, lines: [] }, 'step')).toBe(null)
    expect(hitsOf({ ...done, results: [], click: null }, 'step')).toBe(null)
    expect(hitsOf(null, 'step')).toBe(null)
  })
})
