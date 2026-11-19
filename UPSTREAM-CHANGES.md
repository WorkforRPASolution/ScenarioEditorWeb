# WebManager 에 올릴 변경

편입 때 WebManager 세션이 반영한다. `verbatim` 사본은 여기 적고 고치지 않는다.

| 날짜 | 대상(WebManager 경로) | 내용 | 이유 |
|---|---|---|---|
| 2026-11-01 | server/shared/logger/index.js 카테고리 표 | `scenario-editor` 행 추가 (`features/scenario-editor/`, 시나리오 편집기) | 편집기 로거 카테고리 등록 |
| 2026-11-01 | client/package.json | 편입 때 `@vue-flow/core` 1.48.2·`@vue-flow/minimap` 1.5.4·`@vue-flow/controls` 1.1.3 추가(편집기 순서도) | 편집기 순서도(읽기 전용 Vue Flow) |
| 2026-11-19 | client/package.json·server/package.json | 보안 업그레이드(SEW-015 — 판은 저장소 CLAUDE.md "실행·시험"). WebManager(010aa74)도 같은 판(`mongoose ^9.1.3`·`multer ^2.0.2`·`compression ^1.8.1`·`axios ^1.13.2`·`vitest ^4.0.18` …)이라 같은 Dependabot 알림을 받는다. **mongoose 는 9.9.x 까지**: 9.10 부터 드라이버 `mongodb ~7.6` 이고 드라이버 7.6.0 부터 Mongo 4.4 이상만 받는다(운영 4.2.6). WebManager 는 캐럿 범위라 `npm audit fix`·lock 다시 만들기가 mongoose 9.12(드라이버 7.8)를 골라 운영 접속이 끊길 수 있다 — 판을 고정하고 올린다 | 편입 뒤에는 WebManager 의 의존 판이 적용된다 |
