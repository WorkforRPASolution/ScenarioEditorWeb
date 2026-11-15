// 시험용 ZIP 읽기 — 끝 기록(EOCD) → 가운데 목록 → 파일마다 앞 머리를 읽는다. 압축 없는(store) 항목만 푼다.
// 화면 코드(editor/zip.js)와 따로 쓴 읽기라, 쓰는 쪽이 꼴을 틀리면 여기서 걸린다.
const u16 = (v, o) => v.getUint16(o, true)
const u32 = (v, o) => v.getUint32(o, true)

export async function joinParts(parts) {
  const chunks = []
  for (const p of parts) chunks.push(p instanceof Uint8Array ? p : new Uint8Array(await p.arrayBuffer()))
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

export function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  if (end < 0 || u32(v, end) !== 0x06054b50) throw new Error('끝 기록(EOCD)이 없다')
  const total = u16(v, end + 10)
  if (u16(v, end + 8) !== total) throw new Error('항목 수가 서로 다르다')
  const cdSize = u32(v, end + 12)
  const cdOffset = u32(v, end + 16)
  if (cdOffset + cdSize !== end) throw new Error('가운데 목록의 자리·크기가 맞지 않는다')
  const text = new TextDecoder('utf-8', { fatal: true })
  const entries = []
  let at = cdOffset
  for (let i = 0; i < total; i++) {
    if (u32(v, at) !== 0x02014b50) throw new Error(`가운데 목록 ${i} 의 서명이 틀리다`)
    const flags = u16(v, at + 8)
    const method = u16(v, at + 10)
    const time = u16(v, at + 12)
    const date = u16(v, at + 14)
    const crc = u32(v, at + 16)
    const compSize = u32(v, at + 20)
    const size = u32(v, at + 24)
    const nameLen = u16(v, at + 28)
    const extraLen = u16(v, at + 30)
    const commentLen = u16(v, at + 32)
    const local = u32(v, at + 42)
    const name = text.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    if (u32(v, local) !== 0x04034b50) throw new Error(`${name} 의 앞 머리 서명이 틀리다`)
    const lNameLen = u16(v, local + 26)
    const lExtraLen = u16(v, local + 28)
    const lName = text.decode(bytes.subarray(local + 30, local + 30 + lNameLen))
    if (lName !== name) throw new Error(`앞 머리 이름(${lName})이 가운데 목록(${name})과 다르다`)
    for (const [o, want, what] of [[6, flags, '표시'], [8, method, '방식'], [14, crc, 'CRC'], [18, compSize, '묶은 크기'], [22, size, '크기']]) {
      const got = o === 6 || o === 8 ? u16(v, local + o) : u32(v, local + o)
      if (got !== want) throw new Error(`${name} 의 앞 머리 ${what} 가 가운데 목록과 다르다`)
    }
    if (method !== 0 || compSize !== size) throw new Error(`${name} 은 압축 없는 항목이 아니다`)
    const start = local + 30 + lNameLen + lExtraLen
    entries.push({ name, flags, method, time, date, crc, size, data: bytes.slice(start, start + size) })
    at += 46 + nameLen + extraLen + commentLen
  }
  if (at !== end) throw new Error('가운데 목록 뒤에 남는 바이트가 있다')
  return entries
}
