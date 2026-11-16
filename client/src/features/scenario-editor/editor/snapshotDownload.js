// 스냅샷 다운로드 규칙 (P3 설계 §4.6·§7) — 파일 이름, "좌표 포함" 원 조건, 한도, 한 장씩 차례로 받기, 한 장은 PNG·여러 장은 ZIP.
// 서버에 다운로드 API 는 없다 — 브라우저가 그림 API 로 한 장씩 받아 묶는다. 받지 못한 장은 건너뛰고 끝에 알린다(DC-037).
import { crc32, zipParts } from './zip'

export const DOWNLOAD_LIMIT = 100
export const DOWNLOAD_LIMIT_UNLIMITED = 300 // 관리 등급 1(Unlimited) — 사내는 제한이 없지만 브라우저 메모리 때문에 둔다
// 사내와 같다: DrawEllipse(빨강 펜 두께 5, x−6, y−6, 12, 12)
export const CIRCLE = { diameter: 12, width: 5, color: '#ff0000' }
const CIRCLE_MAX_X = 9000

export const downloadLimit = (me) => (me?.authorityManager === 1 ? DOWNLOAD_LIMIT_UNLIMITED : DOWNLOAD_LIMIT)

// 원을 그릴 스냅샷 — 클릭 스냅샷이고 x < 9000
export function wantsCircle(item) {
  return item?.kind === 'click' && Number.isInteger(item.x) && Number.isInteger(item.y) && item.x >= 0 && item.y >= 0 && item.x < CIRCLE_MAX_X
}

// 파일 이름에 못 쓰는 글자(Windows 기준)와 제어 글자
const safe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')

// `{설비ID}_{yyyy-MM-dd_HH-mm-ss-fff}.png` — 날짜·시각은 목록에 보이는 것(설비 보정 포함), fff 는 파일 ms 의 끝 세 자리(보정은 분 단위라 같다)
// circle = 클릭 자리 원을 그린 그림 — 이름 끝에 `_xy` 를 붙여 "그림만" 으로 받은 것과 가른다(사내 요청 2026-11-16, 사내 데스크톱은 두 이름이 같다)
export function downloadName(eqpId, date, item, { circle = false } = {}) {
  const fff = String(((item.ms % 1000) + 1000) % 1000).padStart(3, '0')
  return `${safe(eqpId)}_${date}_${String(item.time).replace(/:/g, '-')}-${fff}${circle ? '_xy' : ''}.png`
}

// 같은 이름이 또 나오면 확장자 앞에 _2, _3 … (이미 있는 이름과도 겹치지 않게)
export function uniqueNames(names) {
  const used = new Set()
  return names.map((name) => {
    let out = name
    if (used.has(out)) {
      const dot = name.lastIndexOf('.')
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
      for (let n = 2; used.has(out); n++) out = `${stem}_${n}${ext}`
    }
    used.add(out)
    return out
  })
}

// circle = "좌표 포함" 으로 받은 묶음
export const zipName = (eqpId, date, count, { circle = false } = {}) => `${safe(eqpId)}_${date}_snapshots_${circle ? 'xy_' : ''}${count}.zip`

// 고른 순서대로 한 장씩 받는다. 시작할 때 받은 설비·날짜·줄로 끝까지 간다(DC-085 — 부르는 쪽이 그 사이 바뀐 화면 상태를 넘기지 않는다).
// fetchBlob(fileName, signal) → Blob, drawCircle(blob, x, y) → Blob, reasonOf(err) → 화면에 보일 이유, onProgress(끝난 수, 전체)
// 결과: { files: [{ name, blob }], failed: [{ item, reason }], canceled }
export async function runDownload({ eqpId, date, items, withCircle, fetchBlob, drawCircle, reasonOf, signal = null, onProgress = null }) {
  // 원을 그릴 장만 _xy — 원이 없는 장(태그·x ≥ 9000)은 "그림만" 과 같은 바이트라 같은 이름이다
  const names = uniqueNames(items.map((i) => downloadName(eqpId, date, i, { circle: !!withCircle && wantsCircle(i) })))
  const files = []
  const failed = []
  for (let k = 0; k < items.length; k++) {
    if (signal?.aborted) return { files, failed, canceled: true }
    const item = items[k]
    try {
      let blob = await fetchBlob(item.fileName, signal)
      if (withCircle && wantsCircle(item)) {
        // 좌표 포함을 골랐는데 원 없는 그림을 섞지 않는다 — 못 그리면 그 장은 못 받은 것
        try { blob = await drawCircle(blob, item.x, item.y) } catch (cause) { throw Object.assign(new Error('circle failed'), { code: 'CIRCLE_FAILED', cause }) }
      }
      files.push({ name: names[k], blob })
    } catch (e) {
      if (signal?.aborted) return { files, failed, canceled: true } // 취소로 끊긴 것은 못 받은 것이 아니다
      failed.push({ item, reason: await reasonOf(e) })
    }
    if (onProgress) onProgress(k + 1, items.length)
  }
  return { files, failed, canceled: false }
}

// 고른 것이 하나면 그 PNG 그대로, 둘 이상이면(받은 것이 하나뿐이어도) ZIP 하나. 받은 것이 없으면 null.
export async function packDownload({ eqpId, date, requested, files, withCircle = false, now = new Date() }) {
  if (!files.length) return null
  if (requested === 1) return { name: files[0].name, blob: files[0].blob }
  const entries = []
  for (const f of files) {
    const bytes = new Uint8Array(await f.blob.arrayBuffer()) // CRC 만 계산하고 놓는다 — 그림은 Blob 으로 든다
    entries.push({ name: f.name, blob: f.blob, crc: crc32(bytes), size: bytes.length })
  }
  return { name: zipName(eqpId, date, files.length, { circle: !!withCircle }), blob: new Blob(zipParts(entries, now), { type: 'application/zip' }) }
}

// 그림에 클릭 자리 원을 그린 새 PNG. 브라우저 캔버스를 쓴다(E2E 가 원 자리의 색을 본다).
export async function drawCircle(blob, x, y) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    ctx.beginPath()
    ctx.arc(x, y, CIRCLE.diameter / 2, 0, Math.PI * 2)
    ctx.lineWidth = CIRCLE.width
    ctx.strokeStyle = CIRCLE.color
    ctx.stroke()
    return await new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('toBlob failed'))), 'image/png'))
  } finally {
    bitmap.close?.()
  }
}

// 브라우저의 "다운로드" 로 넘긴다
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
