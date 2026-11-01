# WebManager 에 올릴 변경

편입 때 WebManager 세션이 반영한다. `verbatim` 사본은 여기 적고 고치지 않는다.

| 날짜 | 대상(WebManager 경로) | 내용 | 이유 |
|---|---|---|---|
| 2026-11-01 | server/shared/logger/index.js 카테고리 표 | `scenario-editor` 행 추가 (`features/scenario-editor/`, 시나리오 편집기) | 편집기 로거 카테고리 등록 |
| 2026-11-01 | client/package.json | 편입 때 `@vue-flow/core` 1.48.2·`@vue-flow/minimap` 1.5.4·`@vue-flow/controls` 1.1.3 추가(편집기 순서도) | 편집기 순서도(읽기 전용 Vue Flow) |
