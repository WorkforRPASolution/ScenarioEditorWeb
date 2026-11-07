# CLAUDE.md

ScenarioEditorWeb — 사내 ScenarioEditor(C# WPF)를 웹으로 다시 만드는 MVP. WebManager 디자인 시스템 사본 위에서 단독 실행하고, 최종적으로 WebManager 메뉴로 편입한다. 설계·계획은 ARS 루트 `docs/scenario-editor-web/`(README 색인)에 있다.

## 새 세션 시작점
- 다음 할 일은 `next --prefix SEW-` 로 본다. 페이즈 P2~P6 = SEW-010~014 이고 deps 로 순서가 걸려 있다(P2 선행 SEW-005). 각 항목 note 에 근거 문서·확정 결정·설계 때 정할 질문 번호가 있다. 운영·사내 확인이 남은 질문 묶음은 SEW-016 이다.
- 정본은 ARS 루트 `docs/scenario-editor-web/` 다. 이 저장소의 세션 메모리에는 없다.
  - 웹 결정: `analysis/40-decisions-and-confirmed-facts.md` §2.0(날짜순 결정 표)·§2.1~§2.12
  - 열린 질문: `analysis/42-open-questions.md`(§1.0b = 사내 코드 대조 답)
  - 결함: `analysis/41-defects.md`(SE 사내 결함·DC·TX)
  - 기능별 분석 `analysis/10~22`, 공통 설계 `design/common-design.md`, P1 설계 `design/p1-view-design.md`
  - 새 결정·답이 나오면 40·42 와 해당 기능 문서에 적는다.
- 페이즈 진행은 P1 과 같다: brainstorming → 설계 문서(`design/`) 사용자 승인 → 계획(`plans/`) → 구현(TDD). 문서를 만들거나 옮기기 전에 `docs/scenario-editor-web/README.md` 색인을 읽는다.
- 사내 사실은 두 곳에서 온다.
  - 사본 `ARS/ScenarioEditor/ArsScenarioEditor`: 사용자가 사내 코드를 옮겨 적은 부분 사본이다. 2026-11-03 부터 코드 참조용으로만 쓴다(더 옮겨 적지 않음). 지시 없이 고치지 않는다.
  - 사내 전체 코드: 사용자가 Codex 로 대조해 답을 전해 준다(42 §1.0b).

## 백로그
- 접두사 **`SEW-`** (2026-11-01 신설) — `cd ~/Backlog && npm run backlog -- next --prefix SEW-` (CLI 전용, 규칙은 전역 `~/.claude/CLAUDE.md`).
- 접두사 **`SE-`** 도 이 세션이 쓴다(2026-11-03 사용자 결정) — 사내 ScenarioEditor(데스크톱) 코드에서 고칠 결함 기록용이다. 웹 작업 중 사내 결함을 찾으면 `--prefix SE- --parent none --category scenario-editor` 로 등록하고, 웹에서 피하는 방법은 해당 SEW 페이즈 항목 note 에 적는다. 이 저장소에서 고칠 일은 `SEW-` 다. 기존 SE-001~019 의 웹 처리는 SEW-010~013 note 에 있다.

## 저장소 규칙
- 자체 git. 원격 `origin` = https://github.com/WorkforRPASolution/ScenarioEditorWeb (비공개, 2026-11-02 사용자가 만들고 연결을 지시). 기본 브랜치 `main`. 푸시는 사용자가 요청할 때만.
- `client/`·`server/` 의 WebManager 사본은 `UPSTREAM.json` 이 출처(커밋·sha256·판정)를 기록한다. `verbatim` 파일은 고치지 않는다 — 고칠 일은 `UPSTREAM-CHANGES.md` 에 적는다. `npm run upstream:check` 가 손댄 사본을 잡는다.
- 사본을 다시 가져올 때는 WebManager 작업 트리를 읽지 않고 `git -C ../WebManager show <커밋>:<경로>` 로만 꺼낸다(`npm run upstream:import`).
- 편입 대상은 `client/src/features/scenario-editor/`·`server/features/scenario-editor/` 둘뿐이다. 다른 기능 폴더를 import 하지 않는다.
- 백엔드는 127.0.0.1 에서만 받는다. 시험 데이터는 공유 로컬 EARS 에 `SEW` 접두사로만 넣는다.
- `server/localGuard.js`(Host 허용 목록·쓰기 출처 검사)는 단독판 전용이고 편입 때 사라진다. 단독판으로 사내 운영 DB 저장 시험까지 하기로 해 두었다(2026-11-04, 분석 40 §2.0).

## 실행·시험
- 처음: `npm install && npm --prefix client install && npm --prefix server install && npm --prefix tools install`, `npx playwright install chromium`(E2E 브라우저), `cp server/.env.example server/.env`, `cp client/.env.example client/.env`
- 개발: `npm run dev` (클라이언트 5173, 서버 3100). 개발용 사용자 바꾸기(localStorage `se-dev-user` → 헤더 `X-SE-User`, 이미지는 `?seUser=`)는 `server/.env` 의 `SE_DEV_USER_OVERRIDE=1`(예시 기본값 0)이고 루프백 요청일 때만 듣는다.
- 시험: `npm test` (tools·server·client vitest), TDD 가 기본이다(ARS 루트 CLAUDE.md).
- rollup 은 client·server·tools 의 `package.json` `overrides` 로 4.67.3 에 고정했다(2026-11-02) — 잠겨 있던 4.67.4 는 2026-11-01 배포라 사내 npm 미러에 아직 없었다. 미러가 따라오면 풀어도 된다. lock 을 맥에서 다시 만들면 플랫폼별 선택 의존(`@rollup/rollup-win32-x64-msvc`·`@esbuild/win32-x64` 등)이 lock 에 남았는지 확인한다(사내 PC 는 Windows).
- 사내 운영 EARS 읽기 시험: `server/.env.inhouse.example` 을 `server/.env` 로, 절차·하지 말 것은 README. 핵심은 `SE_WEBMANAGER_DB=0`(`server/webManagerDb.js` — EARS 만 연결·접속 이름 `ScenarioEditorWeb`·WebManagerLog 저장 끔·`/api/health` 는 EARS 기준). verbatim 사본(`connection.js`·`errorHandler.js`·로그 모델)은 고치지 않고 셸(`index.js`·`app.js`)에서 고른다. 2026-11-02 로컬 프로파일러 확인: EARS 는 `find`·읽기 집계뿐, 다른 DB 0건.
- InterfaceServer: `tools/infra/prepare-is.sh && docker compose -f infra/docker-compose.yml up -d` (JVM `-Xmx1536m`·컨테이너 `mem_limit: 2g`. 메모리: 막 올렸을 때 약 405 MiB, 110MB 시나리오(BIG_200) 저장 뒤 최고 약 1500 MiB(cgroup memory.peak)·저장 뒤 1.3 GiB 안팎에 머문다. 2026-11-01 측정. `-Xmx512m`/768m 에서는 110MB 본문 해석 중 OutOfMemoryError). 확인: `tools/infra/smoke-is.sh`
- 통합 시험: `npm run seed -- reset basic anomaly && npm --prefix server run test:integration` (로컬 Mongo·Redis·InterfaceServer). `server/.env` 의 `WEBMANAGER_DB_URI` 는 반드시 `SE_WEB_DEV` — 비워 두면 연결 코드가 WebManager 의 실제 로그 DB(`WEB_MANAGER`)로 떨어진다(배포 시험은 아니면 아무것도 쓰기 전에 멈춘다). `reset` 은 BIG_200 도 지우므로 측정 전에 `seed -- big` 을 다시 한다.
  - 2026-11-07 기준 63건: `api.int.test.js` 41(P1)·`deploy.int.test.js` 19·`webRepo.int.test.js` 3, 약 18초(그중 hang 고장 주입이 setscenario 시간 제한 약 15.5초를 기다린다).
  - 배포 시험(`deploy.int.test.js`)은 시드 시나리오를 읽기만 하고 `SEW_W_<시각>_…` 이름으로 복사 배포해 바꾼다. 끝나면(실패해도) `SEW_W_` 의 SC_PROPERTY·GridFS·Redis 필드와 시험 사용자 7명의 초안·초안 그림·배포 기록을 지운다.
  - 고장 주입은 `tools/infra/fault-proxy.js`(127.0.0.1 빈 포트 중계, 모드 pass·down·hang·slow500·dropAfter)를 시험이 직접 띄우고 `EARS_INTERFACE_URL` 을 그리로 바꿨다가 되돌린다. 따로 띄울 것은 없다. 중계 단위 시험: `npm --prefix tools test -- faultProxy`.
  - 마무리 실패는 시험이 `deps.repo.finishDeploy` 를 한 번 던지게 감싸 만들고, "운영 속성 문서만 사라진 판" 은 시험이 SEW_W_ 문서를 직접 지워 만든다(delscenario 는 SC_PROPERTY → GridFS 순서로 지운다). 정규가 아닌 base64(줄바꿈) 판은 시드 적재처럼 `interfaceClient.setScenario` 로 한 번 쓴다.
- E2E: `npm run e2e` (시험 데이터 reset basic anomaly 가 먼저). 설정 `client/playwright.config.js`, 시험 `client/e2e/scenario-editor/`(7종 × 화면 1600×1000·1920×1080). 시험이 서버 3100(`PORT=3100`·`HOST=127.0.0.1`·`SE_DEV_USER_OVERRIDE=1`, `ALLOWED_ORIGINS` 에 5180 추가)과 클라이언트 5180(`VITE_API_URL=http://localhost:3100/api`)을 직접 띄우고 끝나면 내린다 — 값은 설정이 넘겨 로컬 `.env` 와 상관없다. 이미 떠 있는 서버는 다시 쓰지 않으므로 두 포트가 비어 있어야 한다(`npm run dev` 를 내린 뒤). 5173 은 다른 프로젝트 Vite 와 겹칠 수 있어 쓰지 않는다.
- 큰 시나리오 측정: `npm run seed -- big` 후 서버(`SE_DEV_USER_OVERRIDE=1 npm --prefix server start` — `open-big.js` 가 `X-SE-User: sew_master` 로 부른다)를 띄우고 `node tools/measure/open-big.js` (끝나면 서버를 내린다).
- 큰 시나리오 배포 측정: 위 서버를 `EARS_INTERFACE_MAX_REQUEST_MB=512` 로 띄우고(`.env.example` 에 있다. 로컬 InterfaceServer `max-content-length` 512m 과 같게 — 없으면 100MB 라 BIG_200 요청 약 116MB 가 `REQUEST_TOO_LARGE` 로 막힌다) `node tools/measure/deploy-big.js`. BIG_200 을 열어 가운데 스텝 설명만 바꿔 같은 이름으로 배포(force)하고 `X-SE-Deploy-Stats` 의 `ms ≤ 60000`·`peakRssMb ≤ 1024`·`result 'ok'` 를 검사한다(하나라도 어기면 종료 코드 1). 부를 때마다 BIG_200 에 새 판이 생기므로 끝나면 `npm run seed -- reset basic anomaly && npm run seed -- big` 으로 되돌린다.
- 큰 시나리오 측정 (2026-11-07, 열기 응답에 `edited`·배포 추가 뒤): 서버는 `/usr/bin/time -l node index.js`(server 폴더, `npm --prefix server start` 와 같은 명령)로 띄워 재고 PID 로 내렸다. 로컬 Mongo·InterfaceServer 컨테이너 기준, 사내 값 아님.
  - 열기(`open-big.js` 세 번, 같은 서버): 첫 열기 서버 425~470ms(벽시계 439~489ms)·peakRssMb 236~341, 다시 열기 서버 5ms(벽시계 12~13ms). 뼈대 응답 506,867자(JSON, 압축 전 — `edited` 를 더해 313,942자에서 늘었다). `/usr/bin/time -l` 최대 상주 메모리 342.6 MiB(359,202,816바이트).
  - 배포(`deploy-big.js` 세 번, 같은 서버, 매번 새 현재 판을 차갑게 연 뒤 배포): 서버 4,287·3,953·3,979ms(벽시계 4,293·3,960·3,986ms)·peakRssMb 365·411·515, 요청 115,907,568바이트. `/usr/bin/time -l` 최대 상주 메모리 520.5 MiB(545,767,424바이트). 목표(60초·1GB) 안이라 `csJsonEscape` 빠른 길은 두지 않았다. 세 번 배포한 뒤 InterfaceServer 컨테이너 메모리 1.80 GiB / 2 GiB(JVM 이 힙을 돌려주지 않음).
- 큰 시나리오 측정 (2026-11-04, BI 흘려 읽기 뒤): BIG_200 첫 열기 서버 403~451ms(벽시계 415~467ms)·peakRssMb 230~313, 다시 열기 서버 3~4ms(벽시계 8~10ms). 같은 서버에서 연달아 세 번 잰 실행의 `/usr/bin/time -l` 최대 상주 메모리 287~301 MiB(두 번 잼, 316,096,512바이트까지). 흘려 읽기 전(아래)보다 메모리는 절반 아래, 첫 열기는 2배쯤 느리다. 로컬 Mongo 기준, 사내 값 아님.
- 큰 시나리오 측정 (2026-11-01, 흘려 읽기 전): BIG_200(200 스텝, BI 114,881,881바이트) 첫 열기 서버 258ms(`stats.ms`, 벽시계 270ms)·서버 peakRssMb 658(`X-SE-Open-Stats`, 100ms 간격 표본), 다시 열기 서버 4ms(벽시계 9ms, 디스크 뼈대 캐시), 뼈대 응답 313,942자(JSON, 압축 전). 앞의 ms 는 서버가 잰 `stats.ms` 이고 클라이언트가 잰 벽시계 값은 뒤 괄호다. `/usr/bin/time -l` 로 잰 프로세스 최대 상주 메모리 649 MiB(680,607,744바이트)가 표본값과 맞는다. 다시 잰 실행들: 첫 열기 서버 226~262ms(벽시계 240~280ms)·peakRssMb 637~674(674 는 한도를 낮춘 실패 경로 확인 실행)·다시 열기 서버 3~4ms(벽시계 7~9ms). `open-big.js` 는 첫 30초·다시 1초·peakRssMb 1024 이하와 fromCache(첫 false·다시 true)를 모두 검사하고 하나라도 어기면 종료 코드 1 이다. 로컬 Mongo·차가운 서버 기준, 사내 값 아님.

## P1 완료 확인 (2026-11-01)
설계(ARS `docs/scenario-editor-web/design/p1-view-design.md`) §2 완료 조건 6개. 로컬 Mongo·Redis·InterfaceServer 컨테이너, 시험 데이터 `seed -- reset basic anomaly` + `seed -- big` 을 새로 넣은 뒤 확인했다.
1. **전 종류 열기** — 통합 시험 "전 종류 열기" 22건(basic 15·anomaly 7, 스텝마다 조건·동작·다음 스텝·경고·알림을 `expected.json` 과 비교) 통과. E2E ①(ALL_ACTIONS 18 스텝 동작 표시 = 기대값, 순서도 18 카드, 1번 스텝 상세·기준 화면·검색 영역)·⑤(NEXT_RULES 를 주소 쿼리로 열기, 경고 스텝 찾기, 새로고침 뒤 다시 열림) 통과.
2. **공정 권한** — 통합 시험 사용자 7명(`sew_master`·`sew_cvd`·`sew_multi`·`sew_mastercvd`·`sew_spaces`·`sew_longgrade`·`sew_none`)과 권한 밖 직접 호출 403 `PROCESS_FORBIDDEN` 통과. E2E ①(`sew_multi` 에 SEWCVD·SEWETCH 만)·③(`sew_none` 은 안내만, 시나리오 바 없음) 통과.
3. **열 수 없는 시나리오** — 통합 시험 DUP_PROPERTY 422·NO_REDIS_FIELD 404·PROPERTYLESS 목록에 없음 통과. 화면(1600×1000·1920×1080, `sew_multi`): SEWCVD·SEWMODELB 목록에 PROPERTYLESS 없음, 상태 열 DUP_PROPERTY "같은 키 2건"·NO_REDIS_FIELD "현재 버전 없음". DUP_PROPERTY 를 두 번 누르면 "저장 데이터를 열 수 없습니다. 같은 공정·모델·이름의 운영 속성 문서가 둘 이상인지 데이터 점검에서 확인하세요.", NO_REDIS_FIELD 는 "시나리오나 버전을 찾지 못했습니다. 현재 버전이 없거나(저장 기록만 있음) 지워졌을 수 있습니다." BAD_VALUES 는 열리고 경고 12·알림 1. 확인 중 상태 열이 표 가로 스크롤 뒤(창 표 영역 약 760px, 열 합계 약 1170px)에 숨어 있어 오른쪽에 고정했다(`LoadDialog.vue`, 단위 시험 추가).
4. **큰 시나리오** — `tools/measure/open-big.js`(새로 띄운 서버): 첫 열기 서버 211ms(벽시계 227ms)·다시 열기 4ms(9ms)·peakRssMb 668, 목표(30초·1초·1GB) 안. 화면(`sew_master`, `cache/refresh?images=1` 로 캐시를 비운 뒤 불러오기 창에서 BIG_200 두 번 누름): 첫 열기 약 0.3초(진행 표시 "0초", 바에 BIG_200 이 뜨기까지 302ms·첫 기준 화면 310ms), 다시 열기 약 0.07초(68ms). 5초 안내 문구는 열기 응답을 6.5초 늦춰 실제 브라우저에서 "시나리오를 여는 중 · 5초 / 큰 시나리오는 처음 열 때 시간이 걸립니다" 로 확인. 순서도 카드 200개, 끌어 이동하면 화면이 움직이고(transform 바뀜) 표에서 150번을 고르면 순서도가 150번 카드로 간다. 목표 안이라 후속 task 는 등록하지 않았다. 로컬 기준, 사내 값 아님.
5. **시험 통과** — `npm test`(tools 49·server 295·client 199), `npm --prefix server run test:integration` 33, `npm run e2e` 14(7종 × 두 화면 크기), `npm run upstream:check` 손댄 verbatim 사본 0.
6. **화면** — E2E ⑥(오른쪽 경계선을 100px 끌면 상세가 넓어지고, 새로고침 뒤에도 유지, 두 번 누르면 기본값)·⑦(다크 모드에서 스텝 표 배경 `rgb(30, 41, 59)`)을 1600×1000·1920×1080 두 프로젝트에서 통과.
