// 내 PC 의 그림 파일을 새 이미지·OCR 스텝의 기준 화면으로 쓰는 규칙(2026-11-17 사내 요청).
// 서버는 올릴 그림으로 PNG 만 받는다(server upload.js) — PNG 는 바이트 그대로, 그 밖(JPG·BMP)은 브라우저에서 PNG 로 바꿔 쓴다.
// PNG 도 파일 참조(File)를 쥐지 않고 메모리로 옮긴 사본을 쓴다 — File 은 디스크의 파일을 가리켜, 고른 뒤 그 파일을 덮어쓰거나 지우면
// 읽을 수 없게 된다(같은 이름으로 다시 캡처하는 일은 흔하다 — 기준 화면이 깨지고 초안 저장·배포의 전송이 실패한다, 독립 검토).
// 영역·누를 곳의 좌표는 기준 화면의 픽셀이다: 설비 화면 전체를 제 크기로 찍은 그림이어야 실행 때 좌표가 맞는다(크기 비교는 sizeDiffers).
import { SNAPSHOT_BASE_MAX_BYTES } from './snapshotStep'

// 파일 고르기 창이 보여 줄 형식
export const LOCAL_BASE_ACCEPT = '.png,.jpg,.jpeg,.bmp,image/png,image/jpeg,image/bmp'
// 이보다 큰 파일은 풀어 보지 않는다(올릴 그림 합계 한도와 같다 — 풀면 탭이 멈출 만한 크기)
export const LOCAL_FILE_MAX_BYTES = 50 * 1048576

// 같은 파일 = 같은 이름·크기·고친 때. 같은 파일로 만든 스텝들은 올릴 그림 하나를 함께 쓴다(스냅샷 키는 줄바꿈이 하나라 겹치지 않는다).
export const localBaseKey = (file) => `file\n${file.name}\n${file.size}\n${file.lastModified}`

const stop = (reason) => Object.assign(new Error(`local base: ${reason}`), { reason })

// 파일 → { key, blob(PNG), w, h }. 쓸 수 없으면 reason 을 단 오류를 던진다: 'notImage'(그림으로 풀리지 않음·빈 파일) · 'tooLarge'(한 장 10MB 초과).
// deps(브라우저 감싸개 — 시험이 갈아 끼운다): decode(blob) → { width, height }(비트맵) · toPng(비트맵) → Blob · isPng(blob) → 참·거짓
export async function prepareLocalBase(file, { decode, toPng, isPng }) {
  if (!(file instanceof Blob) || !(file.size > 0)) throw stop('notImage')
  if (file.size > LOCAL_FILE_MAX_BYTES) throw stop('tooLarge')
  let bitmap
  let png
  try {
    bitmap = await decode(file)
    if (!(bitmap?.width > 0) || !(bitmap?.height > 0)) throw new Error('empty image')
    png = await isPng(file)
  } catch { throw stop('notImage') }
  // PNG 는 그대로 올리므로 파일 크기가 곧 올릴 크기다 — 넘으면 메모리로 옮기기 전에 막는다
  if (png && file.size > SNAPSHOT_BASE_MAX_BYTES) throw stop('tooLarge')
  let blob
  try {
    blob = png ? new Blob([await file.arrayBuffer()], { type: 'image/png' }) : await toPng(bitmap)
  } catch { throw stop('notImage') }
  if (!(blob?.size <= SNAPSHOT_BASE_MAX_BYTES)) throw stop('tooLarge')
  return { key: localBaseKey(file), blob, w: bitmap.width, h: bitmap.height }
}

// 두 그림의 크기가 다른가(한쪽을 모르면 다르다고 하지 않는다)
export const sizeDiffers = (a, b) => !!a && !!b && (a.w !== b.w || a.h !== b.h)
