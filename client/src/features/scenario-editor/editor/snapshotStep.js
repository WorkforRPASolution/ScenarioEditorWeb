// 스냅샷에서 스텝 만들기의 규칙(P3 설계 §4.8) — 큰 화면에 떠 있는 스냅샷 그림을 새 이미지·OCR 스텝의 기준 화면(올릴 그림)으로 쓴다.
// snapshot = { eqpId, fileName, blob } (snapshotStore.shownImage 가 주는 것 — 화면에 보이는 그림과 같은 바이트).

// 서버가 올릴 그림 한 장에 받는 크기(server upload.js MAX_FILE). 넘는 그림은 잡기를 시작하기 전에 알린다 — 다 만든 뒤 저장에서 막히지 않게.
export const SNAPSHOT_BASE_MAX_BYTES = 10 * 1048576

// 같은 스냅샷 = 같은 설비의 같은 파일 이름. 줄바꿈은 설비 ID·파일 이름에 올 수 없어 둘의 경계가 섞이지 않는다.
export const snapshotKey = (eqpId, fileName) => `${eqpId}\n${fileName}`

// 기준 화면으로 쓸 수 없는 까닭: 'none' = 그림이 없다(받는 중·실패·고른 줄 없음), 'tooLarge' = 한 장 크기를 넘는다. 쓸 수 있으면 null.
export function snapshotBaseProblem(snapshot) {
  const b = snapshot?.blob
  if (!snapshot || !snapshot.eqpId || !snapshot.fileName || !(b instanceof Blob) || !(b.size > 0)) return 'none'
  return b.size > SNAPSHOT_BASE_MAX_BYTES ? 'tooLarge' : null
}

// 서버가 한 요청(초안 저장·배포)에 받는 올릴 그림의 합계와 장 수(server upload.js MAX_TOTAL·MAX_FILES).
export const UPLOAD_TOTAL_MAX_BYTES = 50 * 1048576
export const UPLOAD_MAX_FILES = 200

// 이 그림(blob)을 더 올리면 한 번의 저장이 서버 한도를 넘는가. used = 작업본이 지금 쓰는 올릴 그림 Blob 들 —
// Blob 이 아닌 것(서버 초안에만 있는 그림, 다시 보내지 않는다)은 세지 않는다. 'total' = 합계, 'files' = 장 수, 괜찮으면 null.
// 넘은 채로 만들면 초안 저장도 배포도 413 으로 막혀 만든 것을 저장할 길이 없다 — 만들기 전에 알려 먼저 배포하게 한다(배포된 그림은 다시 보내지 않는다).
export function uploadBudgetProblem(blob, used) {
  const blobs = (used ?? []).filter((b) => b instanceof Blob)
  if (blobs.length + 1 > UPLOAD_MAX_FILES) return 'files'
  const total = blobs.reduce((sum, b) => sum + b.size, 0) + (blob?.size ?? 0)
  return total > UPLOAD_TOTAL_MAX_BYTES ? 'total' : null
}
