# 시험 데이터 적재

- `npm run seed -- reset basic anomaly` — SEW 데이터를 지우고 설비·사용자·시나리오를 다시 넣는다.
- `npm run seed -- big` — 큰 시나리오(BIG_200)만 더 넣는다(지우지 않음, 약 40초).
- `npm run seed -- clean` — SEW 데이터만 지운다.
- `npm run seed -- snapshots` — 스냅샷 시험 데이터를 로컬 Cassandra(`ars.snapshotlist`·`ars.snapshot`)에 다시 넣는다(먼저 `SEWT_` 설비의 최근 27일 파티션을 지운다). 접속 값은 `server/.env` 의 `CASSANDRA_*`(환경 변수가 먼저)이고, **주소가 이 PC(루프백)가 아니면 연결하지 않고 멈춘다** — 사내 주소가 든 `.env` 로 돌려도 운영 Cassandra 에 쓰지 않는다. `clean`·`reset` 도 스냅샷을 지우므로(주소가 없거나 연결하지 못하면 알리고 넘어간다) 그 뒤에는 다시 넣는다.
  - 이력(P3-D)도 함께 넣는다: 오늘 태그 한 벌의 txn 에 스텝 셋(`data/history.js` — 둘째 설명에 `<`·`&`·작은따옴표). 로컬 이력 서버(HttpWebServer, `server/.env` 의 `HTTP_WEB_SERVER_URL`)의 `POST /ARS/AppendHistory` 로 넣고(사내에서 판정 서버가 넣는 길), 지울 때는 Cassandra `ars.historylog` 에서 `SEWT_` 설비 줄만 지운다. **이력 서버 주소가 루프백이 아니면 넣지 않고 멈춘다.** 주소가 비어 있으면 알리고 건너뛴다(이력 보기 시험이 실패한다).
  - 넣는 것(2026-11-12 기준 목록 26줄·그림 25장, 640×360 PNG): `SEWT_PHOTO_A01` 오늘 클릭 12장(근무조 경계 포함)·태그 다섯 종 한 벌(같은 txn)·같은 ms 의 클릭과 태그·목록에만 있는 한 장, 어제 클릭 3장, 14일 반 전 클릭 1장("1일 뒤 삭제"); `SEWT_CVD_A01` 오늘 2장. "오늘" 은 돌린 때의 KST 날짜다.
  - 파티션 연·월·일은 스냅샷 서버(WriteWorker)처럼 파일 ms 를 KST 로 읽어 정하고 TTL 은 주지 않는다(테이블 기본 15일).
- 시험 실행(P5, 2026-11-18): 설비 `SEWT_CVD_OFF`(자동조치 OFF — `onoff: 0`), 시나리오 `RUN_PROPS`(basic — 시작 지연 30·재시도 2회 10초·우선순위 5·후속 성공 `ALL_ACTIONS`·실패 `ALL_CONDITIONS`·메일 생략 성공·중지)·`RUN_BAD_CATEGORY`(anomaly — 적재 뒤 `scCategory` 를 Int32 로 바꾼다. CommandServer 는 이런 문서의 실행 요청을 말없이 버린다). `clean`·`reset` 은 `SEWT_` 설비의 실행 기록(`EQP_AUTO_RECOVERY` — CommandServer 흉내가 넣은 것)도 지운다(문서만).
- 에이전트 상태(2026-11-18 — 시나리오 실행이 실행 중인 에이전트에만 보낸다): `seed` 가 로컬 Redis DB0 에 시험 설비의 `AgentMetaInfo:{공정}-{모델}`(해시의 설비 ID 칸)·`AgentRunning:{공정}-{모델}-{설비 ID}` 를 만료 없이 넣는다(`lib/agents.js`). 설비 `SEWT_CVD_AGOFF` 는 정보만(= 꺼짐), `SEWT_CVD_NOAG` 는 아무것도 없다(= 정보 없음), 나머지는 실행 중. `clean`·`reset` 이 `AgentRunning:SEW*`·`AgentMetaInfo:SEW*` 를 지운다. **주소는 곧바로 거절되는 `127.0.0.1:9` 로 적는다** — InterfaceServer 는 시나리오를 저장할 때 그 공정·모델의 실행 중인 에이전트마다 시나리오를 보내려 하고, 닿지 않는 주소면 에이전트마다 5초를 기다려 저장이 시간 초과로 끝난다.
- 2026-11-01 기준 적재 결과(`reset basic anomaly`, 약 1초): SC_PROPERTY SEW 23 · fs.files SEW 24 · Redis DB0 키 6개(`SEW{CVD,ETCH,PHOTO}-SEWMODEL{A,B}`) · 설비 12(AGENT_INFO 13) · 사용자 6. 공유 로컬 EARS 의 SEW 가 아닌 EQP_INFO 82건은 그대로.
- 시나리오 해시는 Redis DB0 에서 확인했다(설계 §3.1).
- `npm run seed -- big` (2026-11-01): `big/BIG_200 setscenario crtime=1793535641775` — HTTP 200, askTimeout 없음. setscenario 6.7초(명령 전체 37.7초, 대부분은 110MB BI 생성). 적재 후 SC_PROPERTY SEW 24 · fs.files SEW 25(BIG_200 114,881,881바이트, 청크 110개) · `SEWPHOTO-SEWMODELA` 해시 필드 4개.
- InterfaceServer 힙: 처음 `-Xmx512m`/`mem_limit: 768m` 에서는 요청 본문(110.5MB)을 문자열로 바꾸다 `OutOfMemoryError: Java heap space` 로 JVM 이 종료돼 실패했다. `-Xmx1536m`/`mem_limit: 2g`(`infra/docker-compose.yml`)로 올려 성공: 막 올렸을 때 405 MiB, 적재 중·뒤 최고 약 1500 MiB(컨테이너 cgroup `memory.peak`), 적재 뒤에도 1.3 GiB 안팎에 머문다(JVM 이 힙을 돌려주지 않음).
