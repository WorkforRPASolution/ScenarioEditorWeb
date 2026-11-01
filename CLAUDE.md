# CLAUDE.md

ScenarioEditorWeb — 사내 ScenarioEditor(C# WPF)를 웹으로 다시 만드는 MVP. WebManager 디자인 시스템 사본 위에서 단독 실행하고, 최종적으로 WebManager 메뉴로 편입한다. 설계·계획은 ARS 루트 `docs/scenario-editor-web/`(README 색인)에 있다.

## 백로그
- 접두사 **`SEW-`** (2026-11-01 신설) — `cd ~/Backlog && npm run backlog -- next --prefix SEW-` (CLI 전용, 규칙은 전역 `~/.claude/CLAUDE.md`).

## 저장소 규칙
- 자체 git, 원격 없음. 푸시하지 않는다.
- `client/`·`server/` 의 WebManager 사본은 `UPSTREAM.json` 이 출처(커밋·sha256·판정)를 기록한다. `verbatim` 파일은 고치지 않는다 — 고칠 일은 `UPSTREAM-CHANGES.md` 에 적는다. `npm run upstream:check` 가 손댄 사본을 잡는다.
- 사본을 다시 가져올 때는 WebManager 작업 트리를 읽지 않고 `git -C ../WebManager show <커밋>:<경로>` 로만 꺼낸다(`npm run upstream:import`).
- 편입 대상은 `client/src/features/scenario-editor/`·`server/features/scenario-editor/` 둘뿐이다. 다른 기능 폴더를 import 하지 않는다.
- 백엔드는 127.0.0.1 에서만 받는다. 시험 데이터는 공유 로컬 EARS 에 `SEW` 접두사로만 넣는다.

## 실행·시험
- 처음: `npm install && npm --prefix client install && npm --prefix server install && npm --prefix tools install`, `cp server/.env.example server/.env`, `cp client/.env.example client/.env`
- 개발: `npm run dev` (클라이언트 5173, 서버 3100)
- 시험: `npm test` (tools·server·client vitest), TDD 가 기본이다(ARS 루트 CLAUDE.md).
- InterfaceServer: `tools/infra/prepare-is.sh && docker compose -f infra/docker-compose.yml up -d` (JVM `-Xmx1536m`·컨테이너 `mem_limit: 2g`. 메모리: 막 올렸을 때 약 405 MiB, 110MB 시나리오(BIG_200) 저장 뒤 최고 약 1500 MiB(cgroup memory.peak)·저장 뒤 1.3 GiB 안팎에 머문다. 2026-11-01 측정. `-Xmx512m`/768m 에서는 110MB 본문 해석 중 OutOfMemoryError). 확인: `tools/infra/smoke-is.sh`
