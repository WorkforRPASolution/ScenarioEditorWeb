// Vision·OCR 시험의 상태와 서버 호출(P4 설계 §4.2·§4.3·§4.5) — 그림 준비 → 올리기 → 좌표 보정·판정, 늦은 답 버리기, 키가 바뀌면 지우기
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: { visionTest: vi.fn(), ocrTest: vi.fn() }, imageUrl: (p) => `http://x/api${p}` }))
vi.mock('../editor/images', async (o) => ({ ...(await o()), loadBlob: vi.fn(), bitmapOf: vi.fn() }))
vi.mock('../editor/crop', async (o) => ({ ...(await o()), cropPng: vi.fn() }))
import { scenarioEditorApi as api } from '../api'
import { loadBlob, bitmapOf } from '../editor/images'
import { cropPng } from '../editor/crop'
import { useVisionTestStore } from '../stores/visionTestStore'
import { useSnapshotStore } from '../stores/snapshotStore'
import { testInputOfDraft, testKey, valueKey } from '../editor/visionTest'
import { MESSAGES } from '../messages'
import { imageStep, ocrStep } from './panelFixture'

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const pngBlob = (label, size = 0) => new Blob([new Uint8Array(PNG_HEAD), label, new Uint8Array(size)], { type: 'image/png' })
const ctx = { session: { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' } }, uploads: new Map(), draftId: null }
const IMAGE = () => testInputOfDraft(imageStep(0), ctx) // 영역 (10,20) 300×200, 누를 곳 (24,12)
const OCR = () => testInputOfDraft(ocrStep(1), ctx, null)
const ok = (data) => ({ data: { success: true, data } })
const fail = (status, code) => Object.assign(new Error(code), { response: { status, data: { code } } })
// 그림마다 크기를 정한다: 기준 화면 1920×1200, 찾을 그림 255×96
const SIZES = new Map()
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let store
let snap
let BASE_BLOB
let TRAIN_BLOB
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  SIZES.clear()
  BASE_BLOB = pngBlob('base')
  TRAIN_BLOB = pngBlob('train')
  SIZES.set(BASE_BLOB, { width: 1920, height: 1200 })
  SIZES.set(TRAIN_BLOB, { width: 255, height: 96 })
  loadBlob.mockImplementation(async (url) => (url.includes('train') ? TRAIN_BLOB : BASE_BLOB))
  bitmapOf.mockImplementation(async (blob) => ({ ...SIZES.get(blob), source: blob }))
  cropPng.mockImplementation(async (bitmap, rect) => Object.assign(pngBlob('crop'), { rect, of: bitmap.source }))
  store = useVisionTestStore()
  snap = useSnapshotStore()
  store.syncAccept(0.9, 's0')
})

describe('Vision 시험', () => {
  it('기준 화면에서 검색 영역을 잘라 찾을 그림(원래 바이트)과 함께 올리고, 좌표에 조각의 왼쪽 위를 더한다', async () => {
    api.visionTest.mockResolvedValue(ok({ results: [{ score: 0.9731, x: 86.7, y: 130.2 }, { score: 0.93, x: 86, y: 186 }], ms: 404, bytes: 5000 }))
    expect(await store.start(IMAGE(), { about: { scenario: 'N', step: 1 } })).toBe(true)
    expect(cropPng).toHaveBeenCalledTimes(1)
    expect(cropPng.mock.calls[0][1]).toEqual({ x: 10, y: 20, w: 300, h: 200 })
    const fd = api.visionTest.mock.calls[0][0]
    expect(JSON.parse(fd.get('meta'))).toEqual({ accept: 0.9, about: { scenario: 'N', step: 1 } })
    expect(fd.get('source').rect ?? (await fd.get('source').text()).includes('crop')).toBeTruthy()
    expect(await fd.get('train').text()).toContain('train') // 다시 그리지 않은 원래 바이트
    expect(fd.get('train').size).toBe(TRAIN_BLOB.size)
    expect(store.run).toMatchObject({
      status: 'done', kind: 'image', screen: 'base', stale: false, ms: 404,
      results: [{ score: 0.9731, x: 96, y: 150 }, { score: 0.93, x: 96, y: 206 }],
      train: { w: 255, h: 96 }, click: { x: 120, y: 162 }, verdict: { ok: true, rule: null }, picked: 0
    })
    expect(snap.mode).toBe('step')
  })
  it('시험 정확도 칸의 값을 보낸다 — 패널 값과 달라도', async () => {
    api.visionTest.mockResolvedValue(ok({ results: [], ms: 380, bytes: 1 }))
    store.setAccept('0.4')
    await store.start(IMAGE())
    expect(JSON.parse(api.visionTest.mock.calls[0][0].get('meta')).accept).toBe(0.4)
    expect(store.run).toMatchObject({ status: 'done', results: [], click: null, verdict: { ok: false, rule: null } })
  })
  it('찾을 그림이 PNG 가 아니면 PNG 로 다시 만들어 보낸다', async () => {
    TRAIN_BLOB = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
    SIZES.set(TRAIN_BLOB, { width: 40, height: 20 })
    api.visionTest.mockResolvedValue(ok({ results: [], ms: 1, bytes: 1 }))
    await store.start(IMAGE())
    expect(cropPng).toHaveBeenCalledTimes(2)
    expect(cropPng.mock.calls.some((c) => c[0].source === TRAIN_BLOB && c[1].w === 40 && c[1].h === 20)).toBe(true)
    expect(await api.visionTest.mock.calls[0][0].get('train').text()).toContain('crop')
  })
  it('지금 스냅샷으로 시험: 떠 있는 그림을 쓰고(다시 받지 않는다), 영역이 스냅샷 밖으로 나가면 안쪽만 자르며, 큰 화면을 스냅샷 모드로 바꾼다', async () => {
    const shot = pngBlob('snap')
    SIZES.set(shot, { width: 640, height: 360 })
    snap.shownImage = () => ({ eqpId: 'E1', fileName: 'a.png', blob: shot })
    store.setScreen('snapshot')
    api.visionTest.mockResolvedValue(ok({ results: [{ score: 1, x: 5.5, y: 6.5 }], ms: 10, bytes: 1 }))
    const input = { ...IMAGE(), area: { x: 500, y: 300, w: 300, h: 200 } }
    SIZES.set(TRAIN_BLOB, { width: 100, height: 50 })
    await store.start(input)
    expect(loadBlob).toHaveBeenCalledTimes(1) // 찾을 그림만
    expect(cropPng.mock.calls[0][1]).toEqual({ x: 500, y: 300, w: 140, h: 60 })
    expect(store.run).toMatchObject({ status: 'done', screen: 'snapshot', results: [{ score: 1, x: 505, y: 306 }], size: { w: 640, h: 360 } })
    expect(snap.mode).toBe('snapshot')
  })
  it('기준 화면으로 시험하면 큰 화면을 스텝 그림으로 돌린다(스냅샷을 보고 있었어도)', async () => {
    snap.showSnapshot()
    api.visionTest.mockResolvedValue(ok({ results: [], ms: 10, bytes: 1 }))
    await store.start(IMAGE())
    expect(snap.mode).toBe('step')
  })
})

describe('보내지 않는 경우', () => {
  it('[시험] 이 꺼진 상태면 아무것도 하지 않는다', async () => {
    expect(await store.start({ ...IMAGE(), trainUrl: null })).toBe(false)
    store.setAccept('1.5')
    expect(await store.start(IMAGE())).toBe(false)
    expect(loadBlob).not.toHaveBeenCalled()
    expect(store.run.status).toBe('idle')
  })
  it('조각이 찾을 그림보다 작으면 — "검색 영역이 이 화면 안에 다 들어오지 않습니다"', async () => {
    const shot = pngBlob('snap')
    SIZES.set(shot, { width: 640, height: 360 })
    snap.shownImage = () => ({ eqpId: 'E1', fileName: 'a.png', blob: shot })
    store.setScreen('snapshot')
    await store.start({ ...IMAGE(), area: { x: 500, y: 300, w: 300, h: 200 } }) // 조각 140×60, 찾을 그림 255×96
    expect(store.run).toMatchObject({ status: 'error', message: MESSAGES.SEW_TEST_FAIL_SMALL })
    expect(api.visionTest).not.toHaveBeenCalled()
  })
  it('검색 영역이 화면 밖이면 — "검색 영역이 이 화면 밖에 있습니다"', async () => {
    await store.start({ ...IMAGE(), area: { x: 5000, y: 20, w: 300, h: 200 } })
    expect(store.run).toMatchObject({ status: 'error', message: MESSAGES.SEW_TEST_FAIL_OUTSIDE })
    expect(api.visionTest).not.toHaveBeenCalled()
  })
  it('그림을 받지 못하면 — "그림을 받지 못했습니다"(지워진 판의 그림 등)', async () => {
    loadBlob.mockRejectedValue(new Error('image 404'))
    await store.start(IMAGE())
    expect(store.run).toMatchObject({ status: 'error', message: MESSAGES.SEW_TEST_FAIL_IMAGE })
    expect(api.visionTest).not.toHaveBeenCalled()
  })
  it('두 그림의 합이 4 MiB 를 넘으면 올리지 않고 서버와 같은 문구를 보인다', async () => {
    cropPng.mockImplementation(async () => pngBlob('crop', 4 * 1024 * 1024))
    await store.start(IMAGE())
    expect(store.run).toMatchObject({ status: 'error', message: MESSAGES.SEW_ERR_VISION_TOO_LARGE })
    expect(api.visionTest).not.toHaveBeenCalled()
  })
})

describe('서버 오류', () => {
  it('code 마다 정리된 문구 — 앞의 결과는 남지 않는다', async () => {
    api.visionTest.mockResolvedValueOnce(ok({ results: [{ score: 1, x: 1, y: 1 }], ms: 1, bytes: 1 }))
    await store.start(IMAGE())
    expect(store.run.status).toBe('done')
    for (const [status, code] of [[502, 'VISION_NO_ANSWER'], [503, 'VISION_DOWN'], [503, 'VISION_UNSET'], [504, 'VISION_TIMEOUT'], [429, 'VISION_BUSY'], [413, 'VISION_TOO_LARGE'], [502, 'VISION_FAILED']]) {
      api.visionTest.mockRejectedValueOnce(fail(status, code))
      await store.start(IMAGE())
      expect(store.run, code).toMatchObject({ status: 'error', message: MESSAGES[`SEW_ERR_${code}`] })
      expect(store.run.results).toBeUndefined()
    }
  })
})

describe('OCR 시험', () => {
  it('영역 조각만 올리고 판정·읽은 줄·신뢰도를 정리한다', async () => {
    api.ocrTest.mockResolvedValue(ok({ accepted: true, found: 'IDLE @@ IDLE 2', confidence: ':98:71:99', ms: 1500, bytes: 4000 }))
    expect(await store.start(OCR(), { about: { step: 2 } })).toBe(true)
    expect(cropPng.mock.calls[0][1]).toEqual({ x: 1, y: 2, w: 30, h: 10 })
    const fd = api.ocrTest.mock.calls[0][0]
    expect(JSON.parse(fd.get('meta'))).toEqual({ op: 1, text: 'IDLE', multi: { count: 1, op: 0 }, about: { step: 2 } })
    expect(fd.get('train')).toBeNull()
    expect(store.run).toMatchObject({ status: 'done', kind: 'ocr', accepted: true, lines: ['IDLE', 'IDLE 2'], confidence: { values: [98, 71, 99], min: 71 }, numeric: false, noSuffix: false, ms: 1500 })
  })
  it('수 비교는 신뢰도가 오지 않는다. 접미사 없이 보낸 옛 스텝은 noSuffix', async () => {
    api.ocrTest.mockResolvedValue(ok({ accepted: false, found: '12.5', confidence: '', ms: 900, bytes: 1 }))
    const input = OCR()
    await store.start({ ...input, ocr: { ...input.ocr, op: 7, min: 20, max: 30, multi: null } })
    expect(JSON.parse(api.ocrTest.mock.calls[0][0].get('meta'))).toEqual({ op: 7, min: 20, max: 30 })
    expect(store.run).toMatchObject({ accepted: false, lines: ['12.5'], confidence: { values: [], min: null }, numeric: true, noSuffix: true })
  })
})

describe('겹침·늦은 답', () => {
  it('시험 중에는 다시 시작하지 않는다', async () => {
    const d = deferred()
    api.visionTest.mockReturnValue(d.promise)
    const first = store.start(IMAGE())
    await flush()
    expect(store.run.status).toBe('running')
    expect(await store.start(IMAGE())).toBe(false)
    expect(api.visionTest).toHaveBeenCalledTimes(1)
    d.resolve(ok({ results: [], ms: 1, bytes: 1 }))
    await first
    expect(store.run.status).toBe('done')
  })
  it('키가 바뀌면(다른 스텝·화면·영역) 결과를 지우고 요청을 끊는다 — 늦게 온 답은 버린다', async () => {
    const d = deferred()
    api.visionTest.mockReturnValue(d.promise)
    const input = IMAGE()
    const first = store.start(input)
    await flush()
    const signal = api.visionTest.mock.calls[0][1]
    expect(signal.aborted).toBe(false)
    store.sync(testKey({ ...input, uid: 's9' }, { kind: 'base' }), 'x')
    expect(store.run.status).toBe('idle')
    expect(signal.aborted).toBe(true)
    d.resolve(ok({ results: [{ score: 1, x: 1, y: 1 }], ms: 1, bytes: 1 }))
    await first
    expect(store.run.status).toBe('idle')
  })
  it('값만 바뀌면(정확도·누를 곳) 결과는 남기고 stale — 되돌리면 풀린다. 시험 중에 바뀐 값도 답이 온 뒤 stale', async () => {
    api.visionTest.mockResolvedValue(ok({ results: [{ score: 1, x: 1, y: 1 }], ms: 1, bytes: 1 }))
    const input = IMAGE()
    await store.start(input)
    const key = testKey(input, { kind: 'base' })
    store.sync(key, valueKey(input, 0.85))
    expect(store.run).toMatchObject({ status: 'done', stale: true })
    expect(store.run.results).toHaveLength(1)
    store.sync(key, valueKey(input, 0.9))
    expect(store.run.stale).toBe(false)
    // 시험 중에 값이 바뀜
    const d = deferred()
    api.visionTest.mockReturnValue(d.promise)
    const running = store.start(input)
    await flush()
    store.sync(key, valueKey(input, 0.5))
    d.resolve(ok({ results: [], ms: 1, bytes: 1 }))
    await running
    expect(store.run).toMatchObject({ status: 'done', stale: true })
  })
  it('close() 는 지우고 끊는다. 실패 뒤 다시 시험할 수 있다', async () => {
    api.visionTest.mockRejectedValueOnce(fail(503, 'VISION_DOWN'))
    await store.start(IMAGE())
    expect(store.run.status).toBe('error')
    api.visionTest.mockResolvedValueOnce(ok({ results: [], ms: 1, bytes: 1 }))
    expect(await store.start(IMAGE())).toBe(true)
    store.close()
    expect(store.run.status).toBe('idle')
  })
  it('pick(i): 결과 표에서 고른 줄', async () => {
    api.visionTest.mockResolvedValue(ok({ results: [{ score: 1, x: 1, y: 1 }, { score: 1, x: 9, y: 9 }], ms: 1, bytes: 1 }))
    await store.start(IMAGE())
    store.pick(1)
    expect(store.run.picked).toBe(1)
    store.pick(7)
    expect(store.run.picked).toBe(1)
  })
})

describe('시험 정확도 칸과 시험할 화면', () => {
  it('패널 값으로 시작해 손대기 전에는 패널 값을 따라가고, 손댄 뒤에는 남는다 — 스텝이 바뀌면 다시 패널 값', () => {
    expect(store.acceptText).toBe('0.90')
    store.syncAccept(0.85, 's0')
    expect(store.acceptText).toBe('0.85')
    store.setAccept('0.7')
    store.syncAccept(0.95, 's0')
    expect(store.acceptText).toBe('0.7')
    store.syncAccept(0.95, 's1')
    expect(store.acceptText).toBe('0.95')
    store.syncAccept(null, 's2') // 패널 값이 틀리면 빈 칸
    expect(store.acceptText).toBe('')
  })
  it('패널 값을 그대로 보인다 — 소수 둘째 자리까지는 두 자리로, 더 긴 값은 줄이지 않는다(다른 값으로 시험하지 않게)', () => {
    const shown = (v) => { store.syncAccept(v, `k${v}`); return store.acceptText }
    expect([0.9, 1, 0.85, 0.5].map(shown)).toEqual(['0.90', '1.00', '0.85', '0.50'])
    expect([0.875, 0.855, 0.9731].map(shown)).toEqual(['0.875', '0.855', '0.9731'])
  })
  it('시험할 화면: 고른 값이 남는다. 스냅샷을 골랐는데 떠 있는 것이 없으면 screenNow 의 snapshot 이 null', () => {
    expect(store.screenNow()).toEqual({ kind: 'base' })
    store.setScreen('snapshot')
    expect(store.screenNow()).toEqual({ kind: 'snapshot', snapshot: null })
    snap.shownImage = () => ({ eqpId: 'E1', fileName: 'a.png', blob: pngBlob('s') })
    expect(store.screenNow()).toEqual({ kind: 'snapshot', snapshot: { eqpId: 'E1', fileName: 'a.png' } })
    store.setScreen('other')
    expect(store.screen).toBe('snapshot')
  })
  it('시험 줄이 보이는 스텝(target): 큰 화면이 스냅샷 위에 그 스텝의 영역을 그릴 때 쓴다 — 결과를 지워도 남는다', () => {
    expect(store.target).toBe(null)
    store.setTarget(IMAGE())
    expect(store.target).toEqual({ kind: 'image', area: { x: 10, y: 20, w: 300, h: 200 } })
    store.close()
    expect(store.target).toEqual({ kind: 'image', area: { x: 10, y: 20, w: 300, h: 200 } })
    store.setTarget({ ...OCR(), area: null })
    expect(store.target).toBe(null)
    store.setTarget(OCR())
    expect(store.target).toEqual({ kind: 'ocr', area: { x: 1, y: 2, w: 30, h: 10 } })
    store.setTarget(null)
    expect(store.target).toBe(null)
  })
})
