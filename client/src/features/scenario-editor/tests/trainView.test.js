import { describe, it, expect, vi } from 'vitest'
vi.mock('../api', () => ({ imageUrl: (p) => `http://x/api${p}` }))
import { thumbView, spotKey, spotInputOfDraft, spotInputOfStep, spotAround, spotMarks, spotNote } from '../editor/trainView'
import { imageStep, ocrStep } from './panelFixture'

// 찾을 그림 255×96(시드 RESET 단추): 기준 너비 min(150, max(70, 127.5)) = 127.5 → 배율 0.5, 여백 max(6, 15.3) = 15.3
const T = { w: 255, h: 96 }

describe('찾을 그림 + 누를 곳 썸네일의 보일 영역(목업 trainThumb)', () => {
  const M0 = { mark: 0 } // 목업 식 그대로(+ 표시 크기를 보지 않음)
  // 누를 곳에서 네 변까지 화면 거리(px)
  const gaps = (v, m) => [(m.x - v.x1) * v.k, (v.x1 + v.W - m.x) * v.k, (m.y - v.y1) * v.k, (v.y1 + v.H - m.y) * v.k]
  it('누를 곳이 그림 안(테두리 포함)이면 넓히지 않는다', () => {
    for (const m of [{ x: 24, y: 12 }, { x: 0, y: 0 }, { x: 255, y: 96 }]) {
      expect(thumbView(T, m), JSON.stringify(m)).toMatchObject({ outside: false, x1: 0, y1: 0, W: 255, H: 96 })
    }
  })
  it('목업 식: 오른쪽 밖이면 그 지점 + 여백까지 넓히고 기준 너비로 줄인다(위아래 여백도 목업처럼)', () => {
    const v = thumbView(T, { x: 300, y: 12 }, M0)
    expect(v.outside).toBe(true)
    expect(v.x1).toBe(0)
    expect(v.y1).toBeCloseTo(12 - 15.3, 6)
    expect(v.W).toBeCloseTo(315.3, 6)
    expect(v.H).toBeCloseTo(96 - (12 - 15.3), 6)
    expect(v.k).toBeCloseTo(0.5, 6)
  })
  it('목업 식: 왼쪽·위·아래 밖이면 넓힌 쪽의 시작(x1·y1)이 음수, 높이 150 안으로', () => {
    const left = thumbView(T, { x: -3, y: 7 }, M0)
    expect(left.outside).toBe(true)
    expect(left.x1).toBeCloseTo(-18.3, 6)
    expect(left.y1).toBeCloseTo(7 - 15.3, 6)
    expect(left.W).toBeCloseTo(255 + 18.3, 6)
    const up = thumbView(T, { x: 100, y: -40 }, M0)
    expect(up.y1).toBeCloseTo(-55.3, 6)
    expect(up.x1).toBe(0)
    expect(up.H).toBeCloseTo(96 + 55.3, 6)
    expect(up.k).toBeCloseTo(Math.min(0.5, 150 / (96 + 55.3)), 6)
    const down = thumbView(T, { x: 100, y: 400 }, M0)
    expect(down.y1).toBe(0)
    expect(down.H).toBeCloseTo(415.3, 6)
    expect(down.k).toBeCloseTo(150 / 415.3, 6)
    expect(down.H * down.k).toBeCloseTo(150, 6)
  })
  it('여백이 화면에서 + 반 길이(8px)보다 작으면 그만큼 넓혀 + 가 잘리지 않는다 — 네 방향·아주 먼 점', () => {
    for (const m of [{ x: 300, y: 12 }, { x: -3, y: 7 }, { x: 100, y: -40 }, { x: 100, y: 400 }, { x: 5000, y: 3000 }, { x: -4000, y: -10 }, { x: 128, y: 97 }]) {
      const v = thumbView(T, m)
      expect(v.outside, JSON.stringify(m)).toBe(true)
      for (const g of gaps(v, m)) expect(g, JSON.stringify(m)).toBeGreaterThanOrEqual(8 - 1e-6)
      expect(v.W * v.k).toBeLessThanOrEqual(300 + 1e-9)
      expect(v.H * v.k).toBeLessThanOrEqual(150 + 1e-9)
    }
    // RESET 오른쪽 밖: 목업 여백 15.3 × 0.5 = 7.65px → 16(= 8 / 0.5)으로
    const v = thumbView(T, { x: 300, y: 12 })
    expect(v.W).toBeCloseTo(316, 6)
    expect(v.y1).toBeCloseTo(-4, 6)
    expect(v.k).toBeCloseTo(0.5, 6)
  })
  it('목업 여백이 이미 8px 이상이면 목업 식 그대로', () => {
    const small = { w: 40, h: 20 } // 여백 6 × 배율 1.75 = 10.5px
    expect(thumbView(small, { x: 60, y: 10 })).toEqual(thumbView(small, { x: 60, y: 10 }, M0))
  })
  it('아주 먼 점은 최대 크기(300×150) 안으로 줄인다', () => {
    const v = thumbView(T, { x: 5000, y: 3000 })
    expect(Math.max(v.W * v.k / 300, v.H * v.k / 150)).toBeCloseTo(1, 6)
    const far = thumbView(T, { x: -4000, y: 10 }, { maxW: 200, maxH: 100 })
    expect(far.W * far.k).toBeCloseTo(200, 6)
  })
  it('작은 그림은 기준 너비 70, 큰 그림은 150', () => {
    expect(thumbView({ w: 40, h: 20 }, { x: 60, y: 10 }).k).toBeCloseTo(70 / 40, 6)
    expect(thumbView({ w: 400, h: 50 }, { x: 410, y: 10 }).k).toBeCloseTo(150 / 400, 6)
  })
  it('잘못된 크기·누를 곳이면 null', () => {
    for (const s of [null, { w: 0, h: 0 }, { w: 10, h: 0 }, { w: -5, h: 10 }, { w: NaN, h: 10 }, { w: Infinity, h: 10 }]) expect(thumbView(s, { x: 1, y: 1 }), JSON.stringify(s)).toBe(null)
    for (const m of [null, { x: NaN, y: 1 }, { x: 1 }, { x: '1', y: 2 }, { x: Infinity, y: 2 }]) expect(thumbView(T, m), JSON.stringify(m)).toBe(null)
  })
})

describe('찾을 그림 위치 찾기 입력(초점 스텝)', () => {
  const session = { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' } }
  const ctx = { session, uploads: new Map(), draftId: null }
  const url = (id) => `http://x/api/scenario-editor/scenarios/P/M/N/versions/1/files/F/images/${id}`

  it('패널 초안: 기준 화면·찾을 그림(키 0 먼저) URL·검색 영역·누를 곳', () => {
    expect(spotInputOfDraft(imageStep(0), ctx)).toEqual({ baseUrl: url('s0-bi'), trainUrl: url('s0-train-0'), area: { x: 10, y: 20, w: 300, h: 200 }, click: { x: 24, y: 12 } })
    const two = imageStep(0, { images: { train: { 1: { from: 'source', id: 's0-train-1' }, 0: { from: 'source', id: 's0-train-0' } }, base: { from: 'source', id: 's0-bi' } } })
    expect(spotInputOfDraft(two, ctx).trainUrl).toBe(url('s0-train-0'))
  })
  it('패널 초안: 이미지 조건·영역·두 그림이 모두 있어야 한다 — 누를 곳은 마우스 클릭 셋이고 정수일 때만(아니면 click 은 null, 찾기는 한다)', () => {
    const s = imageStep(0)
    for (const type of [1, 2, 3]) expect(spotInputOfDraft({ ...s, action: { ...s.action, type } }, ctx).click).toEqual({ x: 24, y: 12 })
    const noClick = { baseUrl: url('s0-bi'), trainUrl: url('s0-train-0'), area: { x: 10, y: 20, w: 300, h: 200 }, click: null }
    expect(spotInputOfDraft({ ...s, action: { type: 6, typeName: 'Wait', waitSec: 1 } }, ctx)).toEqual(noClick)
    expect(spotInputOfDraft({ ...s, action: { type: 5, typeName: 'Keyboard', raw: 'a', click: { x: 1, y: 2, basis: 'trainImage' } } }, ctx)).toEqual(noClick)
    expect(spotInputOfDraft({ ...s, action: { type: 0, typeName: 'None', raw: '' } }, ctx)).toEqual(noClick)
    expect(spotInputOfDraft({ ...s, action: undefined }, ctx)).toEqual(noClick)
    expect(spotInputOfDraft({ ...s, action: { ...s.action, click: { x: null, y: null, basis: 'trainImage' } } }, ctx)).toEqual(noClick)
    expect(spotInputOfDraft({ ...s, action: { ...s.action, click: { x: 1.5, y: 2, basis: 'trainImage' } } }, ctx)).toEqual(noClick)
    expect(spotInputOfDraft({ ...s, condition: { ...s.condition, searchArea: null } }, ctx)).toBe(null)
    expect(spotInputOfDraft({ ...s, images: { ...s.images, base: { literal: 'AA==' } } }, ctx)).toBe(null)
    expect(spotInputOfDraft({ ...s, images: { ...s.images, train: {} } }, ctx)).toBe(null)
    expect(spotInputOfDraft(ocrStep(0), ctx)).toBe(null)
    expect(spotInputOfDraft(null, ctx)).toBe(null)
  })
  it('표시 스텝(P1 뼈대 모양): 기준 화면·0번 학습 이미지 URL — 누를 곳은 마우스 클릭이고 학습 이미지 기준일 때만(아니면 click 은 null, 찾기는 한다)', () => {
    const st = {
      uid: 's0', baseImage: { state: 'present', url: '/b' },
      condition: { kind: 'image', searchArea: { x: 1, y: 2, w: 30, h: 40 }, image: { trainImages: [{ key: 1, url: '/t1' }, { key: 0, url: '/t0' }] } },
      action: { type: 1, typeName: 'MouseLeftClick', click: { x: -3, y: 7, basis: 'trainImage' } }
    }
    expect(spotInputOfStep(st)).toEqual({ baseUrl: 'http://x/api/b', trainUrl: 'http://x/api/t0', area: { x: 1, y: 2, w: 30, h: 40 }, click: { x: -3, y: 7 } })
    expect(spotInputOfStep({ ...st, baseImage: { state: 'present', src: 'blob:b' }, condition: { ...st.condition, image: { trainImages: [{ key: 0, url: null, src: 'blob:t' }] } } }))
      .toMatchObject({ baseUrl: 'blob:b', trainUrl: 'blob:t' })
    expect(spotInputOfStep({ ...st, baseImage: { state: 'missing' } })).toBe(null)
    const noClick = { baseUrl: 'http://x/api/b', trainUrl: 'http://x/api/t0', area: { x: 1, y: 2, w: 30, h: 40 }, click: null }
    expect(spotInputOfStep({ ...st, action: { ...st.action, click: { x: 1, y: 1, basis: 'screenOrigin' } } })).toEqual(noClick)
    expect(spotInputOfStep({ ...st, action: { type: 5, typeName: 'Keyboard' } })).toEqual(noClick)
    expect(spotInputOfStep({ ...st, action: { type: 0, typeName: 'None' } })).toEqual(noClick)
    expect(spotInputOfStep({ ...st, action: undefined })).toEqual(noClick)
    expect(spotInputOfStep({ ...st, action: { ...st.action, click: { x: null, y: 7, basis: 'trainImage' } } })).toEqual(noClick)
    expect(spotInputOfStep({ ...st, condition: { ...st.condition, image: { trainImages: [] } } })).toBe(null)
    expect(spotInputOfStep({ ...st, condition: { kind: 'ocr', searchArea: st.condition.searchArea } })).toBe(null)
    expect(spotInputOfStep(null)).toBe(null)
  })
  it('키 = 기준 화면·찾을 그림·검색 영역 — 누를 곳만 바뀌면 같은 키', () => {
    const a = spotInputOfDraft(imageStep(0), ctx)
    const b = spotInputOfDraft(imageStep(0, { action: { type: 1, typeName: 'MouseLeftClick', raw: '400:5', click: { x: 400, y: 5, basis: 'trainImage' } } }), ctx)
    expect(spotKey(a)).toBe(spotKey(b))
    expect(spotKey(a)).not.toBe(spotKey({ ...a, area: { ...a.area, w: 301 } }))
    expect(spotKey(a)).not.toBe(spotKey({ ...a, trainUrl: 'blob:x' }))
    expect(spotKey(a)).not.toBe(spotKey({ ...a, baseUrl: 'blob:y' }))
    expect(spotKey(null)).toBe(null)
  })
})

describe('위치 찾기 결과 → 썸네일·큰 화면·문구', () => {
  const input = { baseUrl: 'B', trainUrl: 'T', area: { x: 0, y: 0, w: 900, h: 600 }, click: { x: 300, y: -10 } }
  const one = { found: 'one', x: 711, y: 660, w: 255, h: 96, bw: 1920, bh: 1200 }
  it('한 곳이면 썸네일 주변 채우기(기준 화면 URL·찾은 자리·기준 화면 크기)와 큰 화면 표시(찾은 그림·누를 곳 = 찾은 자리 + 누를 곳)', () => {
    expect(spotAround(input, one)).toEqual({ src: 'B', x: 711, y: 660, bw: 1920, bh: 1200 })
    expect(spotMarks(input, one)).toEqual({ train: { x: 711, y: 660, w: 255, h: 96 }, click: { x: 1011, y: 650 } })
  })
  it('누를 곳이 없는 스텝(마우스 클릭이 아닌 동작)은 찾은 그림만 — click 은 null, 썸네일 주변 채우기는 그대로', () => {
    const noClick = { ...input, click: null }
    expect(spotMarks(noClick, one)).toEqual({ train: { x: 711, y: 660, w: 255, h: 96 }, click: null })
    expect(spotAround(noClick, one)).toEqual({ src: 'B', x: 711, y: 660, bw: 1920, bh: 1200 })
    expect(spotMarks(noClick, { found: 'many' })).toBe(null)
    expect(spotNote(noClick, one)).toBe('SEW_UI_SPOT_one')
  })
  it('여러 곳·못 찾음·시간 초과·불러오기 실패·아직 찾는 중이면 채우지도 그리지도 않는다', () => {
    for (const r of [{ found: 'many' }, { found: 'none' }, { found: 'timeout' }, { found: 'error' }, null]) {
      expect(spotAround(input, r)).toBe(null)
      expect(spotMarks(input, r)).toBe(null)
    }
    expect(spotAround(null, one)).toBe(null)
    expect(spotMarks(null, one)).toBe(null)
  })
  it('썸네일 아래 문구: 결과마다 이유, 찾는 중이면 없음, 찾을 수 없는 스텝(기준 화면·영역 없음)이면 저장되어 있지 않음', () => {
    expect(spotNote(input, one)).toBe('SEW_UI_SPOT_one')
    for (const f of ['many', 'none', 'timeout', 'error']) expect(spotNote(input, { found: f })).toBe(`SEW_UI_SPOT_${f}`)
    expect(spotNote(input, { found: 'zzz' })).toBe('SEW_UI_SPOT_error')
    expect(spotNote(input, null)).toBe(null)
    expect(spotNote(null, null)).toBe('SEW_UI_SPOT_NOT_STORED')
  })
})
