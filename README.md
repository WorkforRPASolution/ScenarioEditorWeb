# ScenarioEditorWeb

사내 ScenarioEditor 웹 MVP. 설계: `../docs/scenario-editor-web/design/` · 계획: `../docs/scenario-editor-web/plans/`. 개발(맥·로컬 데이터) 실행법은 `CLAUDE.md`, 사내 Windows PC 에서 운영 DB 로 보는 법(읽기 시험)과 저장해 보는 법(쓰기 시험)은 아래.

## 사내 운영 DB 로 읽기 시험 (Windows)

P1(보기 전용)을 사내 Windows PC 에서 운영 EARS 에 붙여 실제 데이터로 확인한다. 서버는 운영 Mongo·Redis 를 읽기만 한다 — `SE_WEBMANAGER_DB=0` 이 WEBMANAGER DB(오류 기록) 연결과 저장을 끈다. 2026-11-02 로컬에서 이 설정으로 화면의 모든 API 경로(사용자·범위·목록·버전·열기·이미지·데이터 점검·캐시 비우기·오류 응답)를 돌리고 Mongo 프로파일러로 확인했다: EARS 에는 `find` 와 데이터 점검의 읽기 집계뿐이었고 다른 DB 에는 0건이었다.

아래 명령은 **명령 프롬프트(cmd)** 기준이고 PowerShell 에서도 그대로 된다. 한 줄씩 친다.

### 1. 준비물

| 항목 | 내용 | 확인 |
|---|---|---|
| Node.js | 22 LTS(22.12 이상) 또는 20.19 이상 — https://nodejs.org 의 Windows 설치 파일(.msi). Vite 7·mongoose 9 의 하한 | `node -v` |
| Git | Git for Windows | `git --version` |
| npm 저장소 | npmjs 또는 사내 미러에 닿아야 한다(막히면 아래 "문제 해결") | `npm ping` |
| 운영 접속 | 이 PC 에서 운영 Mongo(4.2.6)·Redis 에 닿아야 한다 | — |
| 사용자 | 운영 `ARS_USER_INFO` 에 있는 본인 SingleID | — |

### 2. 받기

```bat
git clone https://github.com/WorkforRPASolution/ScenarioEditorWeb.git
cd ScenarioEditorWeb
```

비공개 저장소라 처음 받을 때 GitHub 로그인 창(Git Credential Manager)이 뜬다. WorkforRPASolution 조직에 권한이 있는 계정으로 로그인한다.

사내망에서 GitHub 에 닿지 않으면 묶음 파일 하나로 옮긴다. 맥에서 `cd ScenarioEditorWeb && git bundle create ../sew.bundle --all` 로 만들고, `sew.bundle` 을 사내 PC 로 옮긴 뒤:

```bat
git clone -b main sew.bundle ScenarioEditorWeb
cd ScenarioEditorWeb
```

### 3. 설치

```bat
npm install
npm --prefix client install
npm --prefix server install
```

`tools` 설치와 Playwright 브라우저는 필요 없다(시험 도구용).

### 4. 설정

```bat
copy server\.env.inhouse.example server\.env
copy client\.env.example client\.env
notepad server\.env
```

메모장에서 `<...>` 자리를 채우고 저장한다. 파일은 구역 `[1]`~`[8]` 로 나뉘어 있고 채울 줄에는 `[채움]` 이 적혀 있다. 맨 위 "채울 곳" 에 시험별로 채울 변수가 있다. 아래 표의 구역 번호가 그 파일의 구역이다.

| 구역 | 변수 | 넣을 값 |
|---|---|---|
| [2] | `MONGODB_URI` | 운영 EARS 주소. 사내 WebManager 설정의 `MONGODB_URI` 형식 그대로. 읽기 전용 계정이 있으면 그것을 쓴다 |
| [3] | `REDIS_URL` | 운영 Redis DB0. 사내 WebManager 설정의 `REDIS_URL` 형식 그대로. Sentinel 이면 `{호스트:포트},{호스트:포트}#master이름` 꼴이고 `REDIS_PASSWORD=` 줄을 더한다 |
| [4] | `SE_USER_SINGLEID` | 본인 SingleID. 이 사용자의 공정·권한으로 보인다 |
| [5] | `SE_WEBMANAGER_DB` | **반드시 `0` 그대로 둔다** |
| [5] | `SE_WEB_DB_URI` | 읽기 시험에서는 비워 둔다(쓰기 시험 때 채운다) |
| [6] | `EARS_INTERFACE_URL` | 읽기 시험에서는 부르지 않으므로 `<...>` 그대로 두어도 된다(쓰기 시험 때 채운다) |

`HOST=127.0.0.1` 도 그대로 둔다(인증 없는 서버라 이 PC 안에서만 받는다). `client\.env` 는 고칠 것이 없다.

`server\.env.example` 은 맥 로컬 개발용이라 사내에서는 쓰지 않는다. 두 파일은 구역과 변수 순서가 같고, 웹 전용 DB 주소를 넣는 변수만 다르다(구역 `[5]` 의 설명 — 사내는 `SE_WEB_DB_URI`, 로컬 개발은 `WEBMANAGER_DB_URI`).

### 5. 실행·확인

```bat
npm run dev
```

창 하나에 `[client]`·`[server]` 로그가 같이 나온다.

1. `[server]` 로그의 `MongoDB EARS Connected` 줄 끝에 `SE_WEBMANAGER_DB=0` 이 있는지 본다. **`MongoDB WEBMANAGER Connected` 가 보이면 바로 끈다** — `server\.env` 에 `SE_WEBMANAGER_DB=0` 이 빠졌다.
2. 브라우저로 http://127.0.0.1:3100/api/health 를 연다 — `"status":"ok"` 와 `"webManager":"disabled"` 가 보여야 한다.
3. 화면: http://localhost:5173/scenario-editor

Windows 방화벽 허용 창이 뜨면 허용하지 않아도 된다(이 PC 안에서만 쓴다). 끌 때는 그 창에서 `Ctrl+C`, "일괄 작업을 끝내시겠습니까 (Y/N)?" 가 나오면 `Y`.

새 버전 받기: 서버를 끈 뒤 `git pull` 하고 3. 설치의 세 줄을 다시 친다.

### 6. 하지 말 것

시험 데이터(SEW)와 로컬 인프라를 전제로 한 명령이다.

- `npm run seed` — 시험 데이터를 EARS 에 넣고 지운다
- `npm --prefix server run test:integration`, `npm run e2e` — 통합 시험과 저장 E2E 는 InterfaceServer 로 `SEW_W_` 시나리오를 배포·삭제하고 SC_PROPERTY 에 직접 쓰며(켜기·끄기·성과), 시험 사용자(`sew_*`)의 초안·배포 기록을 웹 DB 에 썼다가 지운다. E2E 는 서버의 InterfaceServer 주소를 고장 주입 중계로 바꿔 띄운다(맥 로컬 전용 — 실행·전제는 `CLAUDE.md`)
- `node tools/measure/open-big.js`·`deploy-big.js` — 큰 시험 시나리오(BIG_200)를 열고, deploy-big 은 새 판으로 배포한다
- `npm run seed -- snapshots`·`snapshots-big`, `node tools/infra/check-ss-compat.js`, `node tools/measure/snapshot-big.js` — 스냅샷 시험 데이터를 **Cassandra 에 쓰고 지운다**(시험 설비 `SEWT_` 파티션). 웹 서버 자체는 Cassandra 를 읽기만 하지만 이 도구들은 쓴다 — 맥 로컬 전용이다

### 7. 문제 해결

| 증상 | 할 일 |
|---|---|
| PowerShell 에서 `npm` 이 "이 시스템에서 스크립트를 실행할 수 없으므로…" 오류 | 명령 프롬프트(cmd)를 쓰거나 `npm` 대신 `npm.cmd` 로 친다 |
| `npm install` 이 시간 초과·`ECONNREFUSED` | 사내 미러: `npm config set registry <미러 주소>`. 사내 프록시: `npm config set proxy http://<프록시>:<포트>` 와 `npm config set https-proxy http://<프록시>:<포트>` |
| `npm install` 이 `No matching version found for <패키지>@<판>`·`ETARGET` | 사내 미러가 아직 그 판을 받지 않았다. 패키지 이름과 판을 알려 주면 미러에 있는 판으로 고정한다(rollup 은 4.67.3 으로 고정해 두었다) |
| `npm install` 이 `SELF_SIGNED_CERT_IN_CHAIN`·`UNABLE_TO_GET_ISSUER_CERT` | 사내 루트 인증서 파일을 `npm config set cafile <인증서 경로>` 로 준다 |
| 서버가 `EADDRINUSE`·`EACCES` 로 뜨지 않음 | 3100 을 다른 프로그램이 쓰거나 Windows 가 예약한 포트다(`netsh interface ipv4 show excludedportrange protocol=tcp`). `server\.env` 의 `PORT` 와 `client\.env` 의 `VITE_API_URL` 을 같은 새 포트로 바꾼다 |
| Vite 가 5173 대신 5174 같은 다른 포트로 뜸 | 그 주소로 연다. 서버가 그 주소를 거부하므로 `server\.env` 의 `ALLOWED_ORIGINS` 끝에 `,http://localhost:5174` 처럼 더하고 다시 띄운다 |
| 응답이 403 `HOST_FORBIDDEN`·`ORIGIN_FORBIDDEN`, 로그에 같은 코드 | 화면은 `http://localhost:5173` 으로 연다(`127.0.0.1:5173` 은 `ALLOWED_ORIGINS` 에 없어 거부된다). 다른 주소로 열어야 하면 화면 주소를 `server\.env` 의 `ALLOWED_ORIGINS` 에, 서버를 부르는 이름을 `ALLOWED_HOSTS` 에 더하고 다시 띄운다 |
| 서버가 `Failed to start server: …` 로 끝남 | Mongo 에 붙지 못했다. `MONGODB_URI` 의 주소·계정·`authSource` 를 사내 WebManager 설정과 대조한다 |
| `[server]` 로그에 `Redis connection failed`, 화면에 "DB·Redis 에 연결되지 않았습니다" | `REDIS_URL`(Sentinel 이면 `REDIS_PASSWORD` 도)을 사내 WebManager 설정과 대조한다. 서버는 Redis 없이도 뜨지만 목록·버전·열기가 되지 않는다 |
| 시나리오가 열리지 않거나 경고가 이상함 | 화면의 문구와 `server\logs` 의 그날 로그를 함께 적어 온다 |

### 8. 알아 둘 것

- 시나리오를 처음 열면 기준 화면 묶음(BI)을 조각으로 흘려 읽어 PNG 로 디스크에 쓴다. 100MB 급이면 이 PC 메모리를 약 300MB 쓰고(로컬 측정), 운영 Mongo 에서는 그 파일 전체를 읽는다. 서로 다른 시나리오의 첫 열기는 한 번에 하나씩 돈다. 다시 열 때는 `server\.cache\images`(상한 2GB)를 쓰고 Mongo 에서는 파일 id 만 조회한다.
- 데이터 점검 창은 사용자 범위(공정·모델) 안의 `SC_PROPERTY` 를 집계한다. 마스터 사용자면 전체다.
- 실제 운영 데이터는 처음 본다. 해석이 깨지면 화면이 죽지 않고 경고로 보인다. 어떤 시나리오에서 무엇이 어떻게 보였는지(경고 문구·화면) 적어 오면 고친다.

## 사내 쓰기 시험 (Windows)

P2(편집·저장)를 사내 PC 에서 운영 EARS·InterfaceServer 에 붙여 한 번 저장해 본다(설계 §12). **배포가 곧 설비 배포다.** 그래서 새로 만든 꺼진 시나리오 `SEW_TEST_<날짜>` 하나에만 쓴다 — 꺼져 있으면 CommandServer 가 실행 요청을 만들지 않는다. 사용자와 Claude 가 함께 하고 결과를 적는다.

준비물·받기·설치·문제 해결은 위 읽기 시험과 같다. 이미 받아 두었으면 서버를 끄고 `git pull` 한 뒤 설치 세 줄을 다시 친다.

### 1. 어디에 쓰나

| 동작 | 쓰는 곳 |
|---|---|
| 초안 저장 | 웹 전용 DB(`SE_WEB_DB_URI`)만. 운영 EARS 에는 쓰지 않는다 |
| 배포 | 사내 InterfaceServer `setscenario`(본문·기준 화면·운영 속성·판) → 마무리로 **운영 EARS `SC_PROPERTY` 에 직접**(그 시나리오 문서 하나의 `scCategory`·`trCategory`·`property.Owners`, 새 시나리오면 성과 기본값) → 웹 전용 DB 의 배포 기록. 성공하면 그 시나리오의 내 초안을 지운다 |
| 삭제 | 사내 InterfaceServer `delscenario`(운영 속성·판 파일. Redis 판 기록은 남는다 — 사내와 같다) |
| 켜기·끄기(불러오기 창)·심의·성과 저장 | 운영 EARS `SC_PROPERTY` 에 직접 쓴다. **이번 시험에서는 쓰지 않는다** |

그래서 쓰기 시험의 `MONGODB_URI` 는 `SC_PROPERTY` 에 쓸 수 있는 계정이어야 한다(데스크톱 편집기가 저장할 때 쓰는 것과 같은 권한). 읽기 전용 계정이면 설비에는 배포되고 마무리만 실패한다("배포는 됐지만 마무리가 남았습니다" 화면) — 그러면 시험을 멈추고 결과를 적는다.

### 2. 운영 Mongo 계정 (기존 계정)

쓰던 운영 계정을 그대로 쓴다. 이 계정은 EARS 전체에 쓸 수 있어서 DB 권한이 잘못된 쓰기를 막아 주지 않고, 웹 서버에도 "시험 대상만 쓴다" 는 장치가 없다. **7 의 "하지 말 것" 을 지키는 것이 유일한 막이다.** 계정 정보는 `server\.env` 에만 둔다.

초안·초안 그림·배포 기록은 사내 WebManager DB 의 웹 전용 컬렉션 네 개에 둔다: `SCENARIO_EDITOR_DRAFTS`·`SCENARIO_EDITOR_DEPLOYS`·`seDraftImages.files`·`seDraftImages.chunks`. WebManager 가 쓰지 않는 이름이고 첫 쓰기 때 저절로 생긴다(그림 둘은 새로 자른 그림이 든 초안을 저장할 때 생긴다). 편입 뒤에도 같은 이름으로 쓰는 컬렉션이라 지우지 않는다 — 시험 때 쌓인 문서만 운영 적용 전에 한 번 비운다(6-12).

DB 이름은 사내 WebManager 의 `WEBMANAGER_DB_URI` 에 적힌 그대로 쓴다. 기본값은 `WEB_MANAGER` 이고 대소문자를 구분한다. 틀리면 오류 없이 새 DB 가 생긴다. 아래 명령의 `WEB_MANAGER` 는 실제 이름으로 바꿔 친다.

`SE_WEB_DB_URI` 에 `WEBMANAGER_DB_URI` 값을 그대로 넣으면(3) 권한이 이미 맞으니 다음으로 넘어간다. `MONGODB_URI` 의 계정을 쓸 때만 그 계정으로 `mongo` 셸(운영 4.2)에 접속해 권한을 본다.

```js
db.runCommand({ connectionStatus: 1 }).authInfo.authenticatedUserRoles
```

`root`·`readWriteAnyDatabase`, 또는 db 가 WebManager DB 인 `readWrite`·`dbOwner` 가 보이면 된다. 운영 Mongo 에 계정 인증이 꺼져 있으면 빈 목록이 나오고 그대로 쓸 수 있다. 둘 다 아니면 기존 계정의 권한은 바꾸지 않고 `WEBMANAGER_DB_URI` 값을 쓴다.

### 3. 설정

읽기 시험 때 만든 `server\.env` 를 이어 쓴다(없으면 `copy server\.env.inhouse.example server\.env`). **이어 쓸 때는 `server\.env.inhouse.example` 과 구역별로 견주어 빠진 줄을 옮겨 적는다** — 읽기 시험에서 손대지 않은 구역 `[5]`·`[6]` 의 줄이 없거나 비어 있을 수 있다. `EARS_INTERFACE_URL` 줄이 없으면 서버가 `http://localhost:8080` 으로 보내 배포·삭제가 "저장 서버에 연결하지 못했습니다" 로 끝난다(2026-11-10 사내 첫 배포가 이랬다). 사전 점검(4)이 빠진 값을 멈춤으로 알린다.

```bat
notepad server\.env
```

| 구역 | 변수 | 넣을 값 |
|---|---|---|
| [2] | `MONGODB_URI` | 운영 EARS, 기존 계정(사내 WebManager 의 `MONGODB_URI` 와 같은 형식): `mongodb://<계정>:<비밀번호>@<호스트>:<포트>/EARS`. 원래 주소에 `?authSource=…` 가 있으면 그대로 둔다 |
| [5] | `SE_WEB_DB_URI` | 사내 WebManager 의 `WEBMANAGER_DB_URI` 값을 **그대로** 넣는다(DB 이름·계정·`authSource` 가 이미 맞다). `WEBMANAGER_DB_URI` 라는 변수를 새로 만들지 않고 이 변수에 넣는다. `MONGODB_URI` 의 계정을 쓰려면 DB 이름만 WebManager DB 이름으로 바꾸고, **`authSource` 가 없으면 끝에 `?authSource=EARS` 를 붙인다**(안 붙이면 인증에 실패해 서버가 뜨지 않는다) |
| [6] | `EARS_INTERFACE_URL` | 사내 InterfaceServer 주소. **`http://<호스트>:<포트>` 까지만** 적는다 — 앞의 `http://` 를 빼거나 뒤에 `/EARS/Interface`·`/` 를 붙이지 않는다(서버가 붙인다). 사내 WebManager 설정과 같은 값을 쓰되, 그 값이 이 PC 에서 닿지 않으면(쿠버네티스 안쪽 이름 등) 이 PC 의 데스크톱 편집기가 쓰는 주소를 쓴다: 데스크톱 편집기 로그의 `EARSInterfaceSrv: <호스트>:<포트>` 줄(시작할 때 찍는다) 앞에 `http://` 를 붙인다 |
| [6] | `EARS_INTERFACE_MAX_REQUEST_MB` | 사내 InterfaceServer 의 `max-content-length`(MB). 모르면 `100` 그대로 |
| [4] | `SE_USER_SINGLEID` | WRITE 권한이 있는 본인 SingleID |
| [9] | `SE_LINK_PREPROCESSING_SOP` | (선택) 전처리 설정 창에 보일 안내 문서 주소(`http://`·`https://`). 비워 두면 링크가 보이지 않는다. 읽기 시험 때 만든 `.env` 에는 이 줄이 없을 수 있다 — 없어도 된다 |
| [10] | `CASSANDRA_*`·`SE_SNAPSHOT_PARTITION_TZ`·`SE_DISPLAY_TZ`·`HTTP_WEB_SERVER_URL` | 스냅샷·이력(P3) 설정이다. 아직 화면이 없어 **비워 둔다** — `CASSANDRA_CONTACT_POINTS` 가 비어 있으면 서버는 Cassandra 에 연결하지 않는다. 스냅샷 화면이 들어오면 이 표에 넣을 값(Cassandra 주소·읽기 계정·데이터센터 이름)을 적는다. 읽기·쓰기 시험 때 만든 `.env` 에는 이 구역이 없을 수 있다 — 없어도 된다 |
| [1]·[4]·[5] | 그대로 둘 것 | `HOST=127.0.0.1` · `SE_DEV_USER_OVERRIDE=0` · `SE_WEBMANAGER_DB=0` |

### 4. 사전 점검

```bat
node tools\inhouse\preflight.js
```

`멈춤` 줄이 하나라도 있으면 그 줄의 안내대로 고치고 다시 돌린다. 멈춤이 있는 채로 시험하지 않는다. 보는 것: `HOST` 가 이 PC 인지, `SE_WEBMANAGER_DB=0`, 웹 전용 DB 주소가 있고 EARS 와 다른 DB 인지, InterfaceServer 주소의 꼴과 이 PC 에서 그 주소에 연결되는지, 사용자, 다른 사용자로 바꾸기가 꺼졌는지. `tools` 설치 없이 된다.

InterfaceServer 는 연결만 열었다 닫는다(요청은 보내지 않는다). `멈춤 INTERFACE_UNREACHABLE` 이면 배포가 "저장 서버에 연결하지 못했습니다" 로 끝난다 — 괄호 안 글자로 가린다: `ENOTFOUND` 는 이 PC 에서 모르는 이름, `ECONNREFUSED` 는 호스트·포트가 틀림, `TIMEOUT` 은 주소가 틀렸거나 방화벽. 3 의 `EARS_INTERFACE_URL` 안내대로 주소를 고친다.

첫 실행에서는 서버를 아직 띄우지 않았으므로 `경고 SERVER_DOWN` 이 나오는 것이 맞다.

서버를 띄운 뒤(5), 서버 창은 그대로 두고 **새 명령 프롬프트 창**(저장소 폴더)에서 시험 이름과 함께 한 번 더 돌린다. 쓰기 권한, 이름 규칙, 그 이름이 이미 있는지를 본다. 이때는 서버에 닿지 않으면 멈춤이다.

```bat
node tools\inhouse\preflight.js --name SEW_TEST_20261110 --process <공정> --model <모델>
```

이름이 이미 있으면 `SEW_TEST_20261110_2` 처럼 접미사를 바꾼다. `경고 NAME_RULE` 이 나오면 6단계 2번의 "이름 규칙이 있을 때" 를 따른다.

마지막으로 `mongo` 셸에서 그 이름이 운영 EARS 에 정말 없는지 본다(조회만 한다). 사전 점검은 운영 속성이 있는 문서만 보는데, 운영 속성 없는 문서가 남아 있으면 배포가 그 문서에 붙어 기존 성과를 덮는다.

```js
var NAME = 'SEW_TEST_20261110'
db.getSiblingDB('EARS').SC_PROPERTY.countDocuments({ scname: NAME })
db.getSiblingDB('EARS').getCollection('fs.files').countDocuments({ 'metadata.name': NAME })
```

둘 다 `0` 이어야 한다. 아니면 그 이름을 쓰지 않고 접미사를 바꿔 다시 돌린다.

### 5. 실행·확인

```bat
npm run dev
```

`[server]` 로그에서 본다.

1. `MongoDB EARS Connected … SE_WEBMANAGER_DB=0` 과 `MongoDB 웹 전용 DB Connected … (SE_WEB_DB_URI)` 가 둘 다 있다. 웹 전용 DB 줄이 없으면 `SE_WEB_DB_URI` 가 비었다(저장·배포가 503).
2. `HOST=… 는 루프백이 아니라` 경고가 보이면 끄고 `HOST` 를 고친다.
3. `Failed to start server: SE_WEB_DB_URI 의 DB 이름이 운영 EARS…` 로 끝나면 웹 전용 DB 이름을 바꾼다. 웹 전용 DB 에 붙지 못해도 서버가 뜨지 않는다 — 주소·계정을 고치거나, 읽기 시험만 하려면 `SE_WEB_DB_URI` 를 비운다.

### 6. 절차

단계마다 적을 것: 시각, 판 시각(저장 결과 화면의 새 버전·불러오기 창 버전 목록), 화면 사진, 데스크톱 편집기가 연 결과. 실패하면 화면 문구와 `server\logs` 의 그날 로그를 함께 적는다.

**불러오기 창은 마우스로만 쓰고, 오른쪽 칸의 켜짐 스위치는 누르지 않는다.** 스위치는 누르는 순간 확인 없이 운영 EARS 에 쓰고, 누른 뒤 초점이 남아 Space·Enter 로도 바뀐다.

1. **스텝 복사**: 불러오기 창에서 시험할 공정·모델의 시나리오 행을 **두 번 눌러** 연다. 이미지·OCR·대기 스텝 몇 개를 골라 [복사]. (설비 상태 조건 스텝은 새로 만들 수 없는 조건이라 빼고 고른다.) 이 시나리오는 운영 시나리오다. 열려 있는 동안 [복사] 말고는 누르지 않는다.
2. **새 시나리오**: 바 [새 시나리오] → 같은 공정·모델, 이름 `SEW_TEST_<오늘 날짜>`, 메일 제목 → [만들기].
   - **이름 규칙이 있을 때**(새 시나리오 창에 이름 칸이 없고 대·중분류만 고른다): 아무 분류로 만든다. 5번 초안 저장 때 저장 창의 이름 칸을 `SEW_TEST_<오늘 날짜>` 로 바꾸고, 확인 창·저장 창에 보이는 ID 가 그 이름인지 본다.
3. **붙여넣기**: 빈 화면의 [붙여넣기]. 마지막 스텝의 갈 곳이 `NEXT` 면 `SUCCESS` 로 바꾼다.
4. **끄기**: 바 [운영 속성 전체] → [수정] → 켜짐을 끈다 → [적용]. 새 시나리오는 사내처럼 켜진 채 만들어지므로 **꼭 끈다**. 바에 꺼짐이 보이는지 본다.
   - **전처리(선택, P2-F 확인)**: 바 [전처리: …] → 대상 창의 창 제목·클래스 이름을 넣고, [+ 숨길 창 추가]로 숨길 창 하나(클래스 이름 필수)를 넣어 [적용]. 바에 "대상 창 찾음 · 숨길 창 1" 이 보이는지 본다. 값은 실제 설비 프로그램 것이 아니어도 된다(꺼진 시나리오라 실행되지 않는다).
5. **초안 저장**: [저장] → [초안 저장]. 새로고침해도 불러오기 창 [초안 이어서 열기]로 같은 스텝이 열리는지 본다.
6. **배포**: [저장] → [설비에 배포…] → "설비에 배포할까요?" 확인 창에서 **ID 가 `<공정>-<모델>-SEW_TEST_<날짜>` 이고 "꺼져 있어 실행 요청은 만들어지지 않습니다." 가 보일 때만** [배포]. 둘 중 하나라도 아니면 [돌아가기]. 새 버전 시각을 적는다. "배포됐는지 알 수 없습니다" 가 나오면 [버전 목록 확인]부터 누른다(바로 다시 배포하지 않는다). "배포하지 못했습니다 — 저장 서버에 연결하지 못했습니다" 면 아무것도 나가지 않은 것이다: `[server]` 창(또는 `server\logs` 의 그날 로그)의 `UPSTREAM_DOWN` 줄을 적고 사전 점검(4)을 다시 돌린다 — `interface setscenario UPSTREAM_DOWN … (ECONNREFUSED)` 처럼 `interface` 로 시작하면 InterfaceServer 주소 문제다. [버전 목록 확인]·[다시 쓰기]는 배포 때 적어 둔 값을 그대로 쓰므로, 데스크톱에서 그 시나리오를 저장한 뒤에는 누르지 않는다.
   - 배포가 끝나면 `mongo` 셸에서 본다(조회만 한다). **1건이고 `IsEnabled` 가 `false` 여야 한다.** 아니면 7번으로 가지 않고 바로 11번으로 지운다. 지우기가 막히면 데스크톱 편집기로 끄고 멈춘다.
     ```js
     db.getSiblingDB('EARS').SC_PROPERTY.find({ scname: NAME }, { _id: 0, process: 1, eqpModel: 1, scname: 1, scCategory: 1, trCategory: 1, 'property.IsEnabled': 1 }).toArray()
     ```
7. **데스크톱으로 열기**: 사내 ScenarioEditor 로 같은 시나리오를 연다 — 스텝·기준 화면·찾을 그림·운영 속성(사용 꺼짐)이 웹과 같은지 본다.
   - 4번에서 전처리를 넣었으면 데스크톱 편집기의 전처리 창(전처리 버튼)에 같은 대상 창(제목·클래스)과 숨길 창이 보이는지 본다. 위치 확인을 켜지 않은 숨길 창의 좌표는 -18 이다.
8. **데스크톱 판을 웹으로**: 데스크톱에서 스텝 설명 하나만 바꿔 서버에 저장한다(사용 꺼짐 그대로). 웹에서 그 시나리오를 다시 열어(불러오기 창 → 현재 버전) 바뀐 설명과 그림이 보이는지 본다.
9. **고쳐 배포**: 웹에서 이미지 스텝 하나를 골라 기준 화면에서 찾을 그림을 [다시 잡기]로 새로 자르고 배포한다. 확인 창은 6번과 같은 조건일 때만 [배포].
10. **데스크톱으로 다시 열기**: 새로 자른 찾을 그림이 데스크톱에 보이는지 본다.
11. **지우기**: 웹 불러오기 창에서 `SEW_TEST_<날짜>` 행을 고르고, 오른쪽 칸 맨 위 이름이 그 이름인지 본 뒤 [시나리오 지우기…] → 시나리오 이름을 따라 친다(맞게 치는 동안 남은 글자가 회색으로 보인다) → [지우기]. [내 초안도 함께 지웁니다] 가 보이면(그 이름의 내 초안이 남아 있을 때) 체크한다. 끝나면 4 의 조회 두 줄을 다시 돌려 둘 다 `0` 인지 본다. Redis 에 남은 판 기록은 지우지 않고 적기만 한다.
12. **정리(운영 적용 전에 한 번)**: 시험이 끝날 때마다 하지 않는다. 웹 전용 컬렉션 네 개는 편입 뒤에도 같은 이름으로 쓰므로 **컬렉션은 남기고 그 안의 문서만 지운다.** 운영에 웹 편집기를 적용하기 직전에 한 번 해서 시험 때 쌓인 초안·배포 기록을 비운다.
    - 서버를 끄고 한다(배포 중에 배포 기록을 지우면 그 배포의 결과 확인이 안 된다). 시험하던 사람들의 초안이 모두 없어지므로 미리 알린다.
    - 지우기 전에 `SCENARIO_EDITOR_DEPLOYS` 의 배포 기록을 결과와 함께 적어 둔다(조회만): `db.getSiblingDB('WEB_MANAGER').SCENARIO_EDITOR_DEPLOYS.find().sort({ startedAt: 1 }).toArray()`
    - **`dropDatabase` 는 절대 쓰지 않는다 — WebManager DB 전체가 지워진다.** 아래 한 줄만 친다(`WEB_MANAGER` 는 실제 이름으로). 줄마다 지운 문서 수가 나온다. 컬렉션이 없으면 `0` 이다 — `seDraftImages.files`·`seDraftImages.chunks` 는 새로 자른 그림이 든 초안을 저장한 적이 없으면 생기지 않는다(이 절차대로만 했으면 없다). 그림은 두 컬렉션을 함께 비워야 주인 없는 그림 데이터가 남지 않는다.
    - 셸이 오래돼 `deleteMany` 가 없으면 `deleteMany({}).deletedCount` 자리에 `remove({}).nRemoved` 를 쓴다.
    ```js
    var w = db.getSiblingDB('WEB_MANAGER'); ['SCENARIO_EDITOR_DRAFTS', 'SCENARIO_EDITOR_DEPLOYS', 'seDraftImages.files', 'seDraftImages.chunks'].forEach(function (c) { print(c, w.getCollection(c).deleteMany({}).deletedCount) })
    ```

### 7. 하지 말 것

- `SEW_TEST_<날짜>` 말고 다른 시나리오에 배포하지 않는다. 확인 창의 ID 가 다르거나 "덮어씁니다"·"켜져 있는 시나리오입니다." 가 보이면 [돌아가기]. 1번에서 연 운영 시나리오에서는 [저장]을 누르지 않는다.
- [시나리오 지우기…]는 `SEW_TEST_<날짜>` 에만 쓴다. 그 이름의 문서와 모든 판이 지워지고 되살릴 수 없다. 이 단추는 두 곳에 있다 — 불러오기 창 오른쪽 칸(고른 행을 지운다)과 편집 화면 위쪽 바 맨 끝(**지금 열려 있는 시나리오**를 지운다). 1번에서 연 운영 시나리오가 열려 있는 동안 위쪽 바의 것을 누르지 않는다. 눌렀으면 확인 창에서 이름을 치지 않고 닫는다.
- 불러오기 창의 [초안만 남은 것 정리]는 웹 전용 DB 의 내 초안만 지운다(운영 EARS 에는 쓰지 않는다). 시험에 필요하지는 않다.
- 켜지 않는다(운영 속성 켜짐, 불러오기 창 켜기). 켜면 설비에서 실행될 수 있다.
- 불러오기 창의 켜짐 스위치를 누르지 않고, 그 창에서 키보드(Tab·Space·Enter)를 쓰지 않는다. 심의·성과 저장도 하지 않는다. 모두 운영 EARS 에 바로 쓴다.
- 운영 Mongo 셸에는 이 절차에 적힌 줄만 친다. 기존 계정은 EARS 와 WebManager DB 를 고치거나 지울 수 있다.
- `SE_WEBMANAGER_DB` 를 1 로 바꾸지 않는다. 오류 기록이 운영 WebManager DB 에 쌓인다.
- 큰 시나리오를 복사해 배포하지 않는다.
- 위 읽기 시험 "하지 말 것"(시험 데이터·통합 시험·E2E·측정 도구)도 그대로다.

### 8. 잘못 눌렀을 때

- **운영 시나리오의 켜짐 스위치를 눌렀다**: 한 번만 더 눌러 되돌리고, 스위치 옆 글자가 원래 상태인지 본다. 수정 이력(`Owners`)에 두 줄이 남으므로 시나리오 이름과 시각을 적어 그 시나리오 담당자에게 알린다.
- **운영 시나리오에 배포·삭제·심의·성과 저장을 했다**: 웹으로 더 고치지 않는다. 서버를 끄고 화면 사진과 시각을 적어 바로 담당자에게 알린다. 배포했다면 설비에 이미 나간 것이다. 되돌리는 방법은 담당자와 정한다.
