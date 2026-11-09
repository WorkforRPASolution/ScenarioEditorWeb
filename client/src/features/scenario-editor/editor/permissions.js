// 화면의 권한 판정(설계 §3). 버튼 끄기는 편의이고 서버가 매 요청마다 다시 본다.
// 심의(등급·의견)·성과 입력은 관리 등급 1·2(화면 이름 Administrator·Conductor) — 서버 writePolicy REVIEWER_LEVELS 와 같다. WRITE 는 보지 않는다.
export const REVIEWER_LEVELS = [1, 2]

export const isReviewer = (me) => REVIEWER_LEVELS.includes(me?.authorityManager)
