import { imageUrl } from '../api'

const enc = encodeURIComponent
const blobUrls = new WeakMap()

const versionPath = (p, m, n, crtime, fileId, id) =>
  `/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/versions/${enc(crtime)}/files/${enc(fileId)}/images/${enc(id)}`

// 그림 참조 → 브라우저 URL. 못 만들면 null.
export function refUrl(ref, { session, draftId, uploads } = {}) {
  if (!ref) return null
  if (ref.from === 'source') {
    const s = session?.source
    if (!s) return null
    return imageUrl(versionPath(s.process, s.model, s.name, s.crtime, s.fileId, ref.id))
  }
  if (ref.from === 'other') {
    return imageUrl(versionPath(ref.process, ref.model, ref.name, ref.crtime, ref.fileId, ref.id))
  }
  if (ref.from === 'upload') {
    const blob = uploads?.get(ref.tempId)
    if (blob) {
      let u = blobUrls.get(blob)
      if (!u) { u = URL.createObjectURL(blob); blobUrls.set(blob, u) }
      return u
    }
    if (draftId) return draftImageUrl(draftId, ref.tempId)
  }
  return null
}

// 스텝들이 쓰는 올릴 그림(upload 참조)의 tempId — 기준 화면·찾을 그림, 겹치지 않게 처음 나온 순서로.
export function uploadIdsOf(steps) {
  const ids = new Set()
  for (const s of steps) {
    for (const ref of [s?.images?.base, ...Object.values(s?.images?.train ?? {})]) {
      if (ref?.from === 'upload' && ref.tempId) ids.add(ref.tempId)
    }
  }
  return [...ids]
}

// 그림 바이트(Blob) — 서버에만 있는 초안 그림을 다른 세션의 올릴 그림으로 옮길 때(붙여넣기)
export async function loadBlob(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`image ${res.status}`)
  return res.blob()
}

// 다른 출처 <img> 는 canvas 를 오염시키므로 fetch 로 받아 비트맵으로.
export async function loadBitmap(url) {
  return createImageBitmap(await loadBlob(url))
}

// 그림 바이트를 색을 바꾸지 않고 푼다(Vision·OCR 시험의 조각 자르기) — 브라우저가 PNG 의 색 정보(iCCP·gAMA)를 적용하면
// 똑같은 그림에서 자른 조각의 픽셀이 달라져 판정 점수가 떨어진다. (브라우저 전용 얇은 감싸개 — E2E 에서 확인)
export const bitmapOf = (blob) => createImageBitmap(blob, { colorSpaceConversion: 'none' })

// 서버 초안 그림 URL(refUrl 이 로컬 Blob 이 없을 때 쓰는 것과 같은 경로)
export const draftImageUrl = (draftId, tempId) => imageUrl(`/scenario-editor/drafts/${enc(draftId)}/images/${enc(tempId)}`)

export function newTempId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// 바이트 머리로 PNG 인지 본다 — 파일 이름·type 을 믿지 않는다(서버도 올릴 그림의 서명만 본다)
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export async function isPng(blob) {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  return head.length === 8 && PNG_HEAD.every((b, i) => head[i] === b)
}
