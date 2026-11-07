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
    if (draftId) return imageUrl(`/scenario-editor/drafts/${enc(draftId)}/images/${enc(ref.tempId)}`)
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

// 다른 출처 <img> 는 canvas 를 오염시키므로 fetch 로 받아 비트맵으로.
export async function loadBitmap(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`image ${res.status}`)
  return createImageBitmap(await res.blob())
}

export function newTempId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
