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

메모장에서 `<...>` 자리를 채우고 저장한다.

| 변수 | 넣을 값 |
|---|---|
| `MONGODB_URI` | 운영 EARS 주소. 사내 WebManager 설정의 `MONGODB_URI` 형식 그대로. 읽기 전용 계정이 있으면 그것을 쓴다 |
| `REDIS_URL` | 운영 Redis DB0. 사내 WebManager 설정의 `REDIS_URL` 형식 그대로. Sentinel 이면 `{호스트:포트},{호스트:포트}#master이름` 꼴이고 `REDIS_PASSWORD=` 줄을 더한다 |
| `SE_USER_SINGLEID` | 본인 SingleID. 이 사용자의 공정·권한으로 보인다 |
| `SE_WEBMANAGER_DB` | **반드시 `0` 그대로 둔다** |
| `SE_WEB_DB_URI` | 읽기 시험에서는 비워 둔다(쓰기 시험 때 채운다) |

`HOST=127.0.0.1` 도 그대로 둔다(인증 없는 서버라 이 PC 안에서만 받는다). `client\.env` 는 고칠 것이 없다.

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

### 2. 운영 Mongo 계정 (DBA 에게 부탁)

웹이 운영 Mongo 에 쓰는 것은 둘뿐이다: EARS `SC_PROPERTY` 의 update(배포 마무리 — 문서를 새로 만들거나 지우지 않는다)와 웹 전용 DB(초안·배포 기록, 시험 뒤 지우는 임시 DB `SE_WEB_TEST`). 그래서 이 두 권한만 가진 시험 계정을 하나 만든다. 데스크톱 편집기나 사내 WebManager 가 쓰는 계정도 이 권한이 있지만, EARS 의 다른 컬렉션까지 쓸 수 있으므로 시험 계정을 권한다. 사용자 관리 권한이 있는 계정으로 `mongo` 셸(운영 4.2)에서 primary 에 접속해 친다.

```js
use admin
db.createRole({
  role: 'sewScPropertyUpdate',
  privileges: [{ resource: { db: 'EARS', collection: 'SC_PROPERTY' }, actions: ['update'] }],
  roles: []
})
db.createUser({
  user: 'sew_test',
  pwd: passwordPrompt(),
  roles: [
    { role: 'read', db: 'EARS' },
    { role: 'sewScPropertyUpdate', db: 'admin' },
    { role: 'readWrite', db: 'SE_WEB_TEST' }
  ]
})
```

확인: 그 계정으로 접속해 `db.runCommand({ connectionStatus: 1, showPrivileges: true })` — `EARS.SC_PROPERTY` 의 `update` 와 `SE_WEB_TEST` 의 쓰기 권한이 보이면 된다. 계정을 `admin` 에 만들었으므로 주소 끝에 `authSource=admin` 을 붙인다. 운영 Mongo 에 계정 인증이 꺼져 있으면 이 절은 건너뛴다.

### 3. 설정

읽기 시험의 `server\.env` 에 더한다(없으면 `copy server\.env.inhouse.example server\.env`).

```bat
notepad server\.env
```

| 변수 | 넣을 값 |
|---|---|
| `MONGODB_URI` | 운영 EARS, 2 의 시험 계정: `mongodb://sew_test:<비밀번호>@<호스트>:<포트>/EARS?authSource=admin` |
| `SE_WEB_DB_URI` | 웹 전용 임시 DB, 같은 계정: `mongodb://sew_test:<비밀번호>@<호스트>:<포트>/SE_WEB_TEST?authSource=admin`. EARS 와 같은 이름이면 서버가 뜨지 않는다 |
| `EARS_INTERFACE_URL` | 사내 InterfaceServer 주소(사내 WebManager 설정과 같은 값) |
| `EARS_INTERFACE_MAX_REQUEST_MB` | 사내 InterfaceServer 의 `max-content-length`(MB). 모르면 `100` 그대로 |
| `SE_USER_SINGLEID` | WRITE 권한이 있는 본인 SingleID |
| 그대로 둘 것 | `HOST=127.0.0.1` · `SE_WEBMANAGER_DB=0` · `SE_DEV_USER_OVERRIDE=0` |

### 4. 사전 점검

```bat
node tools\inhouse\preflight.js
```

`멈춤` 줄이 하나라도 있으면 그 줄의 안내대로 고치고 다시 돌린다. 멈춤이 있는 채로 시험하지 않는다. 보는 것: `HOST` 가 이 PC 인지, `SE_WEBMANAGER_DB=0`, 웹 전용 DB 주소가 있고 EARS 와 다른 DB 인지, InterfaceServer 주소·사용자, 다른 사용자로 바꾸기가 꺼졌는지. `tools` 설치 없이 된다.

첫 실행에서는 서버를 아직 띄우지 않았으므로 `경고 SERVER_DOWN` 이 나오는 것이 맞다.

서버를 띄운 뒤(5), 서버 창은 그대로 두고 **새 명령 프롬프트 창**(저장소 폴더)에서 시험 이름과 함께 한 번 더 돌린다. 쓰기 권한, 이름 규칙, 그 이름이 이미 있는지를 본다. 이때는 서버에 닿지 않으면 멈춤이다.

```bat
node tools\inhouse\preflight.js --name SEW_TEST_20261110 --process <공정> --model <모델>
```

이름이 이미 있으면 `SEW_TEST_20261110_2` 처럼 접미사를 바꾼다. `경고 NAME_RULE` 이 나오면 6단계 2번의 "이름 규칙이 있을 때" 를 따른다.

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

1. **스텝 복사**: 불러오기 창에서 시험할 공정·모델의 시나리오 하나를 열고, 이미지·OCR·대기 스텝 몇 개를 골라 [복사]. (설비 상태 조건 스텝은 새로 만들 수 없는 조건이라 빼고 고른다.)
2. **새 시나리오**: 바 [새 시나리오] → 같은 공정·모델, 이름 `SEW_TEST_<오늘 날짜>`, 메일 제목 → [만들기].
   - **이름 규칙이 있을 때**(새 시나리오 창에 이름 칸이 없고 대·중분류만 고른다): 아무 분류로 만든다. 5번 초안 저장 때 저장 창의 이름 칸을 `SEW_TEST_<오늘 날짜>` 로 바꾸고, 확인 창·저장 창에 보이는 ID 가 그 이름인지 본다.
3. **붙여넣기**: 빈 화면의 [붙여넣기]. 마지막 스텝의 갈 곳이 `NEXT` 면 `SUCCESS` 로 바꾼다.
4. **끄기**: 바 [운영 속성 전체] → [수정] → 켜짐을 끈다 → [적용]. 새 시나리오는 사내처럼 켜진 채 만들어지므로 **꼭 끈다**. 바에 꺼짐이 보이는지 본다.
5. **초안 저장**: [저장] → [초안 저장]. 새로고침해도 불러오기 창 [초안 이어서 열기]로 같은 스텝이 열리는지 본다. 초안을 저장한 뒤에는 저장할 이름을 바꾸지 않는다(배포한 적 없는 새 시나리오 초안을 다른 이름으로 배포하면 아직 막힌다 — SEW-017).
6. **배포**: [저장] → [설비에 배포…] → "설비에 배포할까요?" 확인 창에서 **ID 가 `<공정>-<모델>-SEW_TEST_<날짜>` 이고 "꺼져 있어 실행 요청은 만들어지지 않습니다." 가 보일 때만** [배포]. 둘 중 하나라도 아니면 [돌아가기]. 새 버전 시각을 적는다. "배포됐는지 알 수 없습니다" 가 나오면 [버전 목록 확인]부터 누른다(바로 다시 배포하지 않는다).
7. **데스크톱으로 열기**: 사내 ScenarioEditor 로 같은 시나리오를 연다 — 스텝·기준 화면·찾을 그림·운영 속성(사용 꺼짐)이 웹과 같은지 본다.
8. **데스크톱 판을 웹으로**: 데스크톱에서 스텝 설명 하나만 바꿔 서버에 저장한다(사용 꺼짐 그대로). 웹에서 그 시나리오를 다시 열어(불러오기 창 → 현재 버전) 바뀐 설명과 그림이 보이는지 본다.
9. **고쳐 배포**: 웹에서 이미지 스텝 하나를 골라 기준 화면에서 찾을 그림을 [다시 잡기]로 새로 자르고 배포한다. 확인 창은 6번과 같은 조건일 때만 [배포].
10. **데스크톱으로 다시 열기**: 새로 자른 찾을 그림이 데스크톱에 보이는지 본다.
11. **지우기**: 웹 불러오기 창에서 `SEW_TEST_<날짜>` 행을 고르고 오른쪽 [시나리오 지우기…] → 시나리오 이름을 그대로 입력 → [지우기]. Redis 에 남은 판 기록은 지우지 않고 적기만 한다.
12. **정리**: 서버를 끄고, DBA 에게 웹 전용 임시 DB 와 시험 계정을 지워 달라고 한다 — `use SE_WEB_TEST` → `db.dropDatabase()`, `use admin` → `db.dropUser('sew_test')` → `db.dropRole('sewScPropertyUpdate')`. 지우기 전에 `SCENARIO_EDITOR_DEPLOYS` 의 배포 기록을 결과와 함께 적어 두면 좋다.

### 7. 하지 말 것

- `SEW_TEST_<날짜>` 말고 다른 시나리오에 배포하지 않는다. 확인 창의 ID 가 다르거나 "덮어씁니다"·"켜져 있는 시나리오입니다." 가 보이면 [돌아가기]. 1번에서 연 운영 시나리오에서는 [저장]을 누르지 않는다.
- 켜지 않는다(운영 속성 켜짐, 불러오기 창 켜기). 켜면 설비에서 실행될 수 있다.
- 불러오기 창의 켜기·끄기, 심의·성과 저장을 하지 않는다(운영 EARS 에 직접 쓴다).
- 큰 시나리오를 복사해 배포하지 않는다.
- 위 읽기 시험 "하지 말 것"(시험 데이터·통합 시험·E2E·측정 도구)도 그대로다.
