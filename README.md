# ScenarioEditorWeb

사내 ScenarioEditor 웹 MVP. 설계: `../docs/scenario-editor-web/design/` · 계획: `../docs/scenario-editor-web/plans/`. 실행법은 `CLAUDE.md`.

## 사내 운영 DB 로 읽기 시험

P1(보기 전용)을 사내 운영 EARS 에 붙여 실제 데이터로 확인한다. 서버는 운영 Mongo·Redis 를 읽기만 한다 — `SE_WEBMANAGER_DB=0` 이 WEBMANAGER DB(오류 기록) 연결과 저장을 끈다. 2026-11-02 로컬에서 이 설정으로 화면의 모든 API 경로(사용자·범위·목록·버전·열기·이미지·데이터 점검·캐시 비우기·오류 응답)를 돌리고 Mongo 프로파일러로 확인했다: EARS 에는 `find` 와 데이터 점검의 읽기 집계뿐이었고 다른 DB 에는 0건이었다.

**준비물**
- Node 20.19 이상(22 이면 22.12 이상) — Vite 7·mongoose 9 의 하한
- npm 저장소(또는 사내 미러) 접근
- 운영 Mongo(4.2.6)·Redis 에 닿는 PC, 운영 `ARS_USER_INFO` 에 있는 본인 SingleID

**받기**
```
git clone https://github.com/WorkforRPASolution/ScenarioEditorWeb.git
```
비공개 저장소라 WorkforRPASolution 조직에 권한이 있는 계정이 필요하다. 사내망에서 GitHub 에 닿지 않으면 묶음 파일 하나로 옮긴다: 집 맥에서 `cd ScenarioEditorWeb && git bundle create ../sew.bundle --all`, 사내에서 `git clone -b main sew.bundle ScenarioEditorWeb`.

**설치·설정**
```
cd ScenarioEditorWeb
npm install && npm --prefix client install && npm --prefix server install
cp server/.env.inhouse.example server/.env    # <...> 를 채운다
cp client/.env.example client/.env
```
`tools/` 설치와 Playwright 는 필요 없다. Windows 명령 프롬프트에서는 `cp` 대신 `copy`, 경로는 `\` 로 쓴다.

**실행·확인**
1. `npm run dev`
2. 서버 로그의 DB 줄이 `MongoDB EARS Connected: … (WEBMANAGER DB 꺼짐, SE_WEBMANAGER_DB=0)` 인지 본다. `MongoDB WEBMANAGER Connected` 가 보이면 바로 끈다 — `server/.env` 에 `SE_WEBMANAGER_DB=0` 이 빠졌다.
3. 브라우저로 http://127.0.0.1:3100/api/health — `"status":"ok"` 와 `"webManager":"disabled"`
4. http://localhost:5173/scenario-editor

**하지 말 것** — 시험 데이터(SEW)와 로컬 인프라를 전제로 한 명령이다.
- `npm run seed` (시험 데이터를 EARS 에 넣고 지운다), `npm --prefix server run test:integration`, `npm run e2e`

**알아 둘 것**
- 시나리오를 처음 열면 기준 화면 묶음(BI)을 통째로 읽는다. 100MB 급이면 이 PC 메모리를 약 650MB 쓰고, 운영 Mongo 에서도 그만큼 읽는다. 다시 열 때는 `server/.cache/images`(상한 2GB)를 쓴다. 동시에 여는 수 제한은 아직 없다(SEW-005) — 혼자 시험한다.
- 데이터 점검 창은 사용자 범위(공정·모델) 안의 `SC_PROPERTY` 를 집계한다. 마스터 사용자면 전체다.
- 실제 운영 데이터는 처음 본다. 해석이 깨지면 화면이 죽지 않고 경고로 보인다. 어떤 시나리오에서 무엇이 어떻게 보였는지(경고 문구·화면) 적어 오면 고친다.
