'use strict'
// 이력 시험 데이터 배치 (P3 설계 §11) — 오늘 태그 한 벌(data/snapshots TODAY_TAGS)의 txn 에 스텝 셋.
// 둘째 설명에는 꺾쇠·앰퍼샌드·작은따옴표를 넣는다 — 이력 서버는 받은 글을 이스케이프 없이 HTML 에 넣는다.
const STEPS = [
  [1, '로그인 창 확인'],
  [2, "A<B & 'x' 버튼 누르기"],
  [3, '완료 화면 확인']
]
const SCREEN = [320, 180] // 판정 때의 화면
const REF = [40, 20] // 찾을 기준 그림

module.exports = { STEPS, SCREEN, REF }
