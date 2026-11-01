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
- E2E: `npm run e2e` (시험 데이터 reset basic anomaly 가 먼저). 설정 `client/playwright.config.js`, 시험 `client/e2e/scenario-editor/`(7종 × 화면 1600×1000·1920×1080). 시험이 서버 3100(`SE_DEV_USER_OVERRIDE=1`, `ALLOWED_ORIGINS` 에 5180 추가 — 설정이 넘긴다)과 클라이언트 5180 을 직접 띄우고 끝나면 내린다. 이미 떠 있는 서버는 다시 쓰지 않으므로 두 포트가 비어 있어야 한다(`npm run dev` 를 내린 뒤). 5173 은 다른 프로젝트 Vite 와 겹칠 수 있어 쓰지 않는다.
- 큰 시나리오 측정: `npm run seed -- big` 후 서버(`npm --prefix server start`)를 띄우고 `node tools/measure/open-big.js` (끝나면 서버를 내린다).
- 큰 시나리오 측정 (2026-11-01): BIG_200(200 스텝, BI 114,881,881바이트) 첫 열기 서버 258ms(`stats.ms`, 벽시계 270ms)·서버 peakRssMb 658(`X-SE-Open-Stats`, 100ms 간격 표본), 다시 열기 서버 4ms(벽시계 9ms, 디스크 뼈대 캐시), 뼈대 응답 313,942자(JSON, 압축 전). 앞의 ms 는 서버가 잰 `stats.ms` 이고 클라이언트가 잰 벽시계 값은 뒤 괄호다. `/usr/bin/time -l` 로 잰 프로세스 최대 상주 메모리 649 MiB(680,607,744바이트)가 표본값과 맞는다. 다시 잰 실행들: 첫 열기 서버 226~262ms(벽시계 240~280ms)·peakRssMb 637~672·다시 열기 서버 3~4ms(벽시계 7~9ms). `open-big.js` 는 첫 30초·다시 1초·peakRssMb 1024 이하와 fromCache(첫 false·다시 true)를 모두 검사하고 하나라도 어기면 종료 코드 1 이다. 기준 안이라 `gridfsRepo.readContent` 흘려 읽기 task 는 등록하지 않았다. 로컬 Mongo·차가운 서버 기준, 사내 값 아님.

## P1 완료 확인 (2026-11-01)
설계(ARS `docs/scenario-editor-web/design/p1-view-design.md`) §2 완료 조건 6개. 로컬 Mongo·Redis·InterfaceServer 컨테이너, 시험 데이터 `seed -- reset basic anomaly` + `seed -- big` 을 새로 넣은 뒤 확인했다.
1. **전 종류 열기** — 통합 시험 "전 종류 열기" 22건(basic 15·anomaly 7, 스텝마다 조건·동작·다음 스텝·경고·알림을 `expected.json` 과 비교) 통과. E2E ①(ALL_ACTIONS 18 스텝 동작 표시 = 기대값, 순서도 18 카드, 1번 스텝 상세·기준 화면·검색 영역)·⑤(NEXT_RULES 를 주소 쿼리로 열기, 경고 스텝 찾기, 새로고침 뒤 다시 열림) 통과.
2. **공정 권한** — 통합 시험 사용자 7명(`sew_master`·`sew_cvd`·`sew_multi`·`sew_mastercvd`·`sew_spaces`·`sew_longgrade`·`sew_none`)과 권한 밖 직접 호출 403 `PROCESS_FORBIDDEN` 통과. E2E ①(`sew_multi` 에 SEWCVD·SEWETCH 만)·③(`sew_none` 은 안내만, 시나리오 바 없음) 통과.
3. **열 수 없는 시나리오** — 통합 시험 DUP_PROPERTY 422·NO_REDIS_FIELD 404·PROPERTYLESS 목록에 없음 통과. 화면(1600×1000·1920×1080, `sew_multi`): SEWCVD·SEWMODELB 목록에 PROPERTYLESS 없음, 상태 열 DUP_PROPERTY "같은 키 2건"·NO_REDIS_FIELD "현재 버전 없음". DUP_PROPERTY 를 두 번 누르면 "저장 데이터를 열 수 없습니다. 같은 공정·모델·이름의 운영 속성 문서가 둘 이상인지 데이터 점검에서 확인하세요.", NO_REDIS_FIELD 는 "시나리오나 버전을 찾지 못했습니다. 현재 버전이 없거나(저장 기록만 있음) 지워졌을 수 있습니다." BAD_VALUES 는 열리고 경고 12·알림 1. 확인 중 상태 열이 표 가로 스크롤 뒤(창 표 영역 약 760px, 열 합계 약 1170px)에 숨어 있어 오른쪽에 고정했다(`LoadDialog.vue`, 단위 시험 추가).
4. **큰 시나리오** — `tools/measure/open-big.js`(새로 띄운 서버): 첫 열기 서버 211ms(벽시계 227ms)·다시 열기 4ms(9ms)·peakRssMb 668, 목표(30초·1초·1GB) 안. 화면(`sew_master`, `cache/refresh?images=1` 로 캐시를 비운 뒤 불러오기 창에서 BIG_200 두 번 누름): 첫 열기 약 0.3초(진행 표시 "0초", 바에 BIG_200 이 뜨기까지 302ms·첫 기준 화면 310ms), 다시 열기 약 0.07초(68ms). 5초 안내 문구는 열기 응답을 6.5초 늦춰 실제 브라우저에서 "시나리오를 여는 중 · 5초 / 큰 시나리오는 처음 열 때 시간이 걸립니다" 로 확인. 순서도 카드 200개, 끌어 이동하면 화면이 움직이고(transform 바뀜) 표에서 150번을 고르면 순서도가 150번 카드로 간다. 목표 안이라 후속 task 는 등록하지 않았다. 로컬 기준, 사내 값 아님.
5. **시험 통과** — `npm test`(tools 49·server 295·client 199), `npm --prefix server run test:integration` 33, `npm run e2e` 14(7종 × 두 화면 크기), `npm run upstream:check` 손댄 verbatim 사본 0.
6. **화면** — E2E ⑥(오른쪽 경계선을 100px 끌면 상세가 넓어지고, 새로고침 뒤에도 유지, 두 번 누르면 기본값)·⑦(다크 모드에서 스텝 표 배경 `rgb(30, 41, 59)`)을 1600×1000·1920×1080 두 프로젝트에서 통과.
