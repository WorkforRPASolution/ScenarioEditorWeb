// 사각형을 정수로 맞추고 그림 안으로 자른다. 빈 영역이면 null.
export function clampRect(rect, width, height) {
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y))
  const x1 = Math.min(width, Math.round(rect.x + rect.w)), y1 = Math.min(height, Math.round(rect.y + rect.h))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// 비트맵의 사각형을 PNG Blob 으로 (브라우저 전용 얇은 감싸개 — E2E 에서 확인).
export async function cropPng(bitmap, rect) {
  const r = clampRect(rect, bitmap.width, bitmap.height)
  if (!r) throw new Error('empty crop')
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(r.w, r.h)
    c.getContext('2d').drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    return c.convertToBlob({ type: 'image/png' })
  }
  const c = document.createElement('canvas')
  c.width = r.w; c.height = r.h
  c.getContext('2d').drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}

// 비트맵 전체의 픽셀(ImageData) — [다시 찍기] 위치 찾기(locate)에 넘긴다(브라우저 전용 얇은 감싸개 — E2E 에서 확인).
export function imageDataOf(bitmap) {
  const w = bitmap.width
  const h = bitmap.height
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(bitmap, 0, 0)
  return g.getImageData(0, 0, w, h)
}
