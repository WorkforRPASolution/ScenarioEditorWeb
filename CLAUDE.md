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
- 통합 시험: `npm run seed -- reset basic anomaly && npm --prefix server run test:integration` (로컬 Mongo·Redis·InterfaceServer). `server/.env` 의 `WEBMANAGER_DB_URI` 는 반드시 `SE_WEB_DEV` — 비워 두면 연결 코드가 WebManager 의 실제 로그 DB(`WEB_MANAGER`)로 떨어진다. `reset` 은 BIG_200 도 지우므로 측정 전에 `seed -- big` 을 다시 한다.
- 큰 시나리오 측정: `npm run seed -- big` 후 서버(`npm --prefix server start`)를 띄우고 `node tools/measure/open-big.js` (끝나면 서버를 내린다).
- 큰 시나리오 측정 (2026-11-01): BIG_200(200 스텝, BI 114,881,881바이트) 첫 열기 서버 258ms(`stats.ms`, 벽시계 270ms)·서버 peakRssMb 658(`X-SE-Open-Stats`, 100ms 간격 표본), 다시 열기 서버 4ms(벽시계 9ms, 디스크 뼈대 캐시), 뼈대 응답 313,942자(JSON, 압축 전). 앞의 ms 는 서버가 잰 `stats.ms` 이고 클라이언트가 잰 벽시계 값은 뒤 괄호다. `/usr/bin/time -l` 로 잰 프로세스 최대 상주 메모리 649 MiB(680,607,744바이트)가 표본값과 맞는다. 다시 잰 실행들: 첫 열기 서버 226~262ms(벽시계 240~280ms)·peakRssMb 637~672·다시 열기 서버 3~4ms(벽시계 7~9ms). `open-big.js` 는 첫 30초·다시 1초·peakRssMb 1024 이하와 fromCache(첫 false·다시 true)를 모두 검사하고 하나라도 어기면 종료 코드 1 이다. 기준 안이라 `gridfsRepo.readContent` 흘려 읽기 task 는 등록하지 않았다. 로컬 Mongo·차가운 서버 기준, 사내 값 아님.
