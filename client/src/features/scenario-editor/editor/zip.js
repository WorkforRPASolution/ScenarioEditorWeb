// 압축 없는 ZIP 묶기 (P3 설계 §4.6·§14.2) — 스냅샷 여러 장을 한 파일로. PNG 는 이미 압축돼 있어 다시 줄이지 않는다.
// 그림 바이트를 다시 복사하지 않도록, 머리(Uint8Array)와 그림(Blob)을 조각 목록으로 돌려준다 — 부르는 쪽이 `new Blob(조각)` 으로 묶는다.
// ZIP64 는 쓰지 않는다: 전체 4GB·항목 65,535개를 넘으면 던진다(다운로드는 300장까지다).

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

// 부호 없는 32비트 CRC-32(ZIP·PNG 가 쓰는 것)
export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const MAX_32 = 0xffffffff
const MAX_ENTRIES = 0xffff
const VERSION = 20
const UTF8_NAME = 0x0800 // 이름이 UTF-8 이라는 표시

// 로컬 시각을 DOS 꼴로(2초 단위, 1980년부터)
function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

// entries = [{ name, blob(Blob 또는 Uint8Array), crc, size }] → 이어 붙이면 ZIP 이 되는 조각들
export function zipParts(entries, date = new Date()) {
  if (entries.length > MAX_ENTRIES) throw new Error(`ZIP 항목이 너무 많습니다: ${entries.length}`)
  const encoder = new TextEncoder()
  const { time, date: day } = dosDateTime(date)
  const parts = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const name = encoder.encode(e.name)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, VERSION, true)
    lv.setUint16(6, UTF8_NAME, true)
    lv.setUint16(8, 0, true) // 압축 없음
    lv.setUint16(10, time, true)
    lv.setUint16(12, day, true)
    lv.setUint32(14, e.crc, true)
    lv.setUint32(18, e.size, true)
    lv.setUint32(22, e.size, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    const entry = new Uint8Array(46 + name.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, VERSION, true)
    cv.setUint16(6, VERSION, true)
    cv.setUint16(8, UTF8_NAME, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, day, true)
    cv.setUint32(16, e.crc, true)
    cv.setUint32(20, e.size, true)
    cv.setUint32(24, e.size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true) // 30~41: 덧붙임·주석 길이, 디스크 번호, 속성 — 모두 0
    entry.set(name, 46)

    parts.push(local, e.blob)
    central.push(entry)
    offset += local.length + e.size
    if (offset > MAX_32) throw new Error('ZIP 이 4GB 를 넘습니다')
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0)
  if (offset + centralSize > MAX_32) throw new Error('ZIP 이 4GB 를 넘습니다')
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  return [...parts, ...central, end]
}
