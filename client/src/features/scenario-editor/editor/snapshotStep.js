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
