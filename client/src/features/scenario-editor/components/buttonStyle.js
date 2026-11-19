// 보조 단추 색(2026-11-19 사용자 결정 — 위쪽 바 시안 비교에서 A "테두리 버튼 + 색 아이콘"을 고르고 다른 보조 단추에도 맞췄다).
// WebManager 에서 가장 많이 쓰는 보조 단추와 같은 흰 바탕·회색 테두리다. 회색으로 채운 단추는 꺼진 단추처럼 보였다 — 꺼지면 흐려진다.
// 크기(높이·여백·글자·둥글기)는 쓰는 곳이 정한다. 채운 색은 뜻이 있을 때만 쓴다: 주 동작 파랑(bg-primary-500), 지우기 빨강, 주의 호박색.
// CSS 로 그린 창 단추(.se-sv-btn — save.css, .se-pp-btn — property.css)도 같은 모양이다.
export const SECONDARY = 'bg-white dark:bg-dark-card border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 shadow-sm hover:enabled:bg-gray-50 dark:hover:enabled:bg-dark-border disabled:opacity-50 disabled:cursor-not-allowed'
