// 스냅샷 다운로드 규칙 (P3 설계 §4.6·§7, DC-037·DC-085) — 이름·원 조건·한도·차례로 받기·묶기
import { describe, it, expect } from 'vitest'
import {
  DOWNLOAD_LIMIT, DOWNLOAD_LIMIT_UNLIMITED, CIRCLE, downloadLimit, wantsCircle, downloadName, uniqueNames, zipName, runDownload, packDownload
} from '../editor/snapshotDownload'
import { joinParts, unzip } from './helpers/unzip'

const click = (ms, time, x, y) => ({ fileName: `${ms}_[${x}][${y}].png`, ms, time, kind: 'click', tag: null, x, y, txn: null })
const tag = (ms, time, code = 9999) => ({ fileName: `${ms}_[${code}][${ms}].png`, ms, time, kind: 'tag', tag: 'start', x: null, y: null, txn: String(ms) })
const blobOf = (s) => new Blob([new TextEncoder().encode(s)], { type: 'image/png' })
const textOf = async (blob) => new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))

describe('한도·원 조건', () => {
  it('한 번에 100장, 관리 등급 1(Unlimited)만 300장', () => {
    expect([DOWNLOAD_LIMIT, DOWNLOAD_LIMIT_UNLIMITED]).toEqual([100, 300])
    expect(downloadLimit({ authorityManager: 1 })).toBe(300)
    for (const me of [{ authorityManager: 2 }, { authorityManager: 3 }, { authorityManager: 0 }, { authorityManager: '1' }, {}, null, undefined]) expect(downloadLimit(me)).toBe(100)
  })

  it('원은 클릭 스냅샷이고 x < 9000 일 때만 — 지름 12·두께 5·빨강', () => {
    expect(CIRCLE).toEqual({ diameter: 12, width: 5, color: '#ff0000' })
    expect(wantsCircle(click(1, '00:00:00', 412, 288))).toBe(true)
    expect(wantsCircle(click(1, '00:00:00', 0, 0))).toBe(true)
    expect(wantsCircle(click(1, '00:00:00', 8999, 10))).toBe(true)
    expect(wantsCircle(click(1, '00:00:00', 9000, 10))).toBe(false)
    expect(wantsCircle(click(1, '00:00:00', 9994, 10))).toBe(false)
    expect(wantsCircle(tag(1, '00:00:00'))).toBe(false)
    expect(wantsCircle({ kind: 'click', x: null, y: 3 })).toBe(false)
    expect(wantsCircle({ kind: 'click', x: 3, y: undefined })).toBe(false)
    expect(wantsCircle(null)).toBe(false)
  })
})

describe('파일 이름', () => {
  it('{설비ID}_{yyyy-MM-dd_HH-mm-ss-fff}.png — 시각은 목록에 보이는 시각, fff 는 파일 ms 의 끝 세 자리', () => {
    expect(downloadName('SEWT_PHOTO_A01', '2026-11-16', click(1794790382004, '09:13:02', 412, 288))).toBe('SEWT_PHOTO_A01_2026-11-16_09-13-02-004.png')
    // 보정된 시각(목록의 time)을 쓴다 — 파일 ms 로 다시 계산하지 않는다
    expect(downloadName('E1', '2026-11-01', click(1793455800999, '00:30:00', 1, 1))).toBe('E1_2026-11-01_00-30-00-999.png')
    expect(downloadName('E1', '2026-11-16', tag(1794790800000, '10:00:00'))).toBe('E1_2026-11-16_10-00-00-000.png')
  })

  it('설비 ID 의 파일 이름에 못 쓰는 글자는 밑줄로', () => {
    expect(downloadName('A/B\\C:D*E?F"G<H>I|J', '2026-11-16', click(5, '01:02:03', 1, 1))).toBe('A_B_C_D_E_F_G_H_I_J_2026-11-16_01-02-03-005.png')
    expect(zipName('A/B', '2026-11-16', 3)).toBe('A_B_2026-11-16_snapshots_3.zip')
  })

  it('원을 그린 그림은 이름 끝에 _xy, 좌표 포함 ZIP 은 snapshots_xy — 그림만 받은 것과 이름이 겹치지 않는다(사내 요청)', () => {
    const c = click(1794790382004, '09:13:02', 412, 288)
    expect(downloadName('E1', '2026-11-16', c, { circle: true })).toBe('E1_2026-11-16_09-13-02-004_xy.png')
    expect(downloadName('E1', '2026-11-16', c, { circle: false })).toBe('E1_2026-11-16_09-13-02-004.png')
    expect(zipName('E1', '2026-11-16', 3, { circle: true })).toBe('E1_2026-11-16_snapshots_xy_3.zip')
    expect(zipName('E1', '2026-11-16', 3, { circle: false })).toBe('E1_2026-11-16_snapshots_3.zip')
  })

  it('같은 이름이 또 나오면 _2, _3 — 이미 있는 이름과도 겹치지 않는다', () => {
    expect(uniqueNames(['a.png', 'b.png', 'a.png', 'a.png'])).toEqual(['a.png', 'b.png', 'a_2.png', 'a_3.png'])
    expect(uniqueNames(['a.png', 'a_2.png', 'a.png'])).toEqual(['a.png', 'a_2.png', 'a_3.png'])
    expect(uniqueNames([])).toEqual([])
  })
})

describe('runDownload — 한 장씩 차례로', () => {
  const ITEMS = [click(1000, '09:00:00', 10, 20), tag(2000, '09:00:01'), click(3000, '09:00:02', 9500, 5), click(3000, '09:00:02', 30, 40)]
  const base = (over = {}) => ({
    eqpId: 'E1', date: '2026-11-16', items: ITEMS, withCircle: false,
    fetchBlob: async (name) => blobOf(`raw:${name}`),
    drawCircle: async (blob, x, y) => blobOf(`circle(${x},${y}):${await textOf(blob)}`),
    reasonOf: async (e) => e.code ?? e.message,
    ...over
  })

  it('고른 순서대로 받아 이름을 붙인다 — 같은 시각 두 장은 번호로 가른다', async () => {
    const order = []
    const progress = []
    const out = await runDownload(base({ fetchBlob: async (name) => { order.push(name); return blobOf(`raw:${name}`) }, onProgress: (d, n) => progress.push([d, n]) }))
    expect(order).toEqual(ITEMS.map((i) => i.fileName))
    expect(out.canceled).toBe(false)
    expect(out.failed).toEqual([])
    expect(out.files.map((f) => f.name)).toEqual(['E1_2026-11-16_09-00-00-000.png', 'E1_2026-11-16_09-00-01-000.png', 'E1_2026-11-16_09-00-02-000.png', 'E1_2026-11-16_09-00-02-000_2.png'])
    expect(await textOf(out.files[0].blob)).toBe(`raw:${ITEMS[0].fileName}`)
    expect(progress).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]])
  })

  it('좌표 포함이면 원 조건에 맞는 장에만 원을 그린다', async () => {
    const out = await runDownload(base({ withCircle: true }))
    expect(await Promise.all(out.files.map((f) => textOf(f.blob)))).toEqual([
      `circle(10,20):raw:${ITEMS[0].fileName}`, `raw:${ITEMS[1].fileName}`, `raw:${ITEMS[2].fileName}`, `circle(30,40):raw:${ITEMS[3].fileName}`
    ])
    // 원을 그린 장만 _xy — 원이 없는 장(태그·x ≥ 9000)은 그림만 받은 것과 같은 바이트이고 같은 이름이다
    expect(out.files.map((f) => f.name)).toEqual(['E1_2026-11-16_09-00-00-000_xy.png', 'E1_2026-11-16_09-00-01-000.png', 'E1_2026-11-16_09-00-02-000.png', 'E1_2026-11-16_09-00-02-000_xy.png'])
  })

  it('받지 못한 장은 건너뛰고 이유와 함께 모은다 — 나머지는 받는다(DC-037)', async () => {
    const progress = []
    const out = await runDownload(base({
      fetchBlob: async (name) => { if (name === ITEMS[1].fileName) throw Object.assign(new Error('x'), { code: 'SNAPSHOT_NOT_FOUND' }); return blobOf('ok') },
      onProgress: (d, n) => progress.push([d, n])
    }))
    expect(out.files).toHaveLength(3)
    expect(out.failed).toEqual([{ item: ITEMS[1], reason: 'SNAPSHOT_NOT_FOUND' }])
    // 못 받은 장의 번호는 다른 장이 쓰지 않는다(이름이 받을 때마다 달라지지 않게)
    expect(out.files.map((f) => f.name)).toEqual(['E1_2026-11-16_09-00-00-000.png', 'E1_2026-11-16_09-00-02-000.png', 'E1_2026-11-16_09-00-02-000_2.png'])
    expect(progress.at(-1)).toEqual([4, 4])
  })

  it('원을 그리지 못한 장은 못 받은 것으로 센다 — 원 없는 그림을 섞지 않는다', async () => {
    const out = await runDownload(base({ withCircle: true, drawCircle: async (blob, x) => { if (x === 10) throw new Error('decode'); return blob } }))
    expect(out.files).toHaveLength(3)
    expect(out.failed).toEqual([{ item: ITEMS[0], reason: 'CIRCLE_FAILED' }])
  })

  it('취소하면 거기서 멈춘다 — 진행 중 요청에 신호가 간다', async () => {
    const controller = new AbortController()
    const seen = []
    const out = await runDownload(base({
      signal: controller.signal,
      fetchBlob: async (name, signal) => {
        seen.push([name, signal === controller.signal])
        if (seen.length === 2) { controller.abort(); throw new Error('aborted') }
        return blobOf('ok')
      }
    }))
    expect(out.canceled).toBe(true)
    expect(out.files).toHaveLength(1)
    expect(out.failed).toEqual([]) // 취소로 끊긴 것은 "못 받은 것" 이 아니다
    expect(seen).toEqual([[ITEMS[0].fileName, true], [ITEMS[1].fileName, true]])
  })

  it('이미 취소됐으면 하나도 받지 않는다', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const out = await runDownload(base({ signal: controller.signal, fetchBlob: async () => { calls++; return blobOf('x') } }))
    expect([out.canceled, out.files.length, calls]).toEqual([true, 0, 0])
  })
})

describe('packDownload — 한 장은 PNG, 여러 장은 ZIP', () => {
  const NOW = new Date(2026, 10, 16, 9, 0, 0)
  const files = [{ name: 'E1_a.png', blob: blobOf('AAA') }, { name: 'E1_b.png', blob: blobOf('BBBB') }]

  it('고른 것이 하나면 그 그림 그대로', async () => {
    const out = await packDownload({ eqpId: 'E1', date: '2026-11-16', requested: 1, files: files.slice(0, 1), now: NOW })
    expect(out.name).toBe('E1_a.png')
    expect(out.blob).toBe(files[0].blob)
  })

  it('둘 이상이면 ZIP — 받은 것이 하나뿐이어도', async () => {
    const two = await packDownload({ eqpId: 'E1', date: '2026-11-16', requested: 2, files, now: NOW })
    expect(two.name).toBe('E1_2026-11-16_snapshots_2.zip')
    expect(two.blob.type).toBe('application/zip')
    const entries = unzip(await joinParts([two.blob]))
    expect(entries.map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual([['E1_a.png', 'AAA'], ['E1_b.png', 'BBBB']])
    const one = await packDownload({ eqpId: 'E1', date: '2026-11-16', requested: 3, files: files.slice(1), now: NOW })
    expect(one.name).toBe('E1_2026-11-16_snapshots_1.zip')
    expect(unzip(await joinParts([one.blob])).map((e) => e.name)).toEqual(['E1_b.png'])
  })

  it('좌표 포함으로 받은 ZIP 은 이름에 xy 가 든다', async () => {
    const out = await packDownload({ eqpId: 'E1', date: '2026-11-16', requested: 2, files, withCircle: true, now: NOW })
    expect(out.name).toBe('E1_2026-11-16_snapshots_xy_2.zip')
  })

  it('받은 것이 없으면 null', async () => {
    expect(await packDownload({ eqpId: 'E1', date: '2026-11-16', requested: 3, files: [], now: NOW })).toBeNull()
  })
})
