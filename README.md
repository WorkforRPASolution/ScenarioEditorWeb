# ScenarioEditorWeb

사내 ScenarioEditor 웹 MVP. 설계: `../docs/scenario-editor-web/design/` · 계획: `../docs/scenario-editor-web/plans/`. 개발(맥·로컬 데이터) 실행법은 `CLAUDE.md`, 사내 Windows PC 에서 운영 DB 로 보는 법은 아래.

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
- `npm --prefix server run test:integration`, `npm run e2e`

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
