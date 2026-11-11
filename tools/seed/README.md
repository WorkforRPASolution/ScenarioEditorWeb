# 시험 데이터 적재

- `npm run seed -- reset basic anomaly` — SEW 데이터를 지우고 설비·사용자·시나리오를 다시 넣는다.
- `npm run seed -- big` — 큰 시나리오(BIG_200)만 더 넣는다(지우지 않음, 약 40초).
- `npm run seed -- clean` — SEW 데이터만 지운다.
- `npm run seed -- snapshots` — 스냅샷 시험 데이터를 로컬 Cassandra(`ars.snapshotlist`·`ars.snapshot`)에 다시 넣는다(먼저 `SEWT_` 설비의 최근 16일 파티션을 지운다). 접속 값은 `server/.env` 의 `CASSANDRA_*`(환경 변수가 먼저). `clean`·`reset` 도 스냅샷을 지우므로(주소가 없거나 연결하지 못하면 알리고 넘어간다) 그 뒤에는 다시 넣는다.
  - 넣는 것(2026-11-12 기준 목록 26줄·그림 25장, 640×360 PNG): `SEWT_PHOTO_A01` 오늘 클릭 12장(근무조 경계 포함)·태그 다섯 종 한 벌(같은 txn)·같은 ms 의 클릭과 태그·목록에만 있는 한 장, 어제 클릭 3장, 14일 반 전 클릭 1장("1일 뒤 삭제"); `SEWT_CVD_A01` 오늘 2장. "오늘" 은 돌린 때의 KST 날짜다.
  - 파티션 연·월·일은 스냅샷 서버(WriteWorker)처럼 파일 ms 를 KST 로 읽어 정하고 TTL 은 주지 않는다(테이블 기본 15일).
- 2026-11-01 기준 적재 결과(`reset basic anomaly`, 약 1초): SC_PROPERTY SEW 23 · fs.files SEW 24 · Redis DB0 키 6개(`SEW{CVD,ETCH,PHOTO}-SEWMODEL{A,B}`) · 설비 12(AGENT_INFO 13) · 사용자 6. 공유 로컬 EARS 의 SEW 가 아닌 EQP_INFO 82건은 그대로.
- 시나리오 해시는 Redis DB0 에서 확인했다(설계 §3.1).
- `npm run seed -- big` (2026-11-01): `big/BIG_200 setscenario crtime=1793535641775` — HTTP 200, askTimeout 없음. setscenario 6.7초(명령 전체 37.7초, 대부분은 110MB BI 생성). 적재 후 SC_PROPERTY SEW 24 · fs.files SEW 25(BIG_200 114,881,881바이트, 청크 110개) · `SEWPHOTO-SEWMODELA` 해시 필드 4개.
- InterfaceServer 힙: 처음 `-Xmx512m`/`mem_limit: 768m` 에서는 요청 본문(110.5MB)을 문자열로 바꾸다 `OutOfMemoryError: Java heap space` 로 JVM 이 종료돼 실패했다. `-Xmx1536m`/`mem_limit: 2g`(`infra/docker-compose.yml`)로 올려 성공: 막 올렸을 때 405 MiB, 적재 중·뒤 최고 약 1500 MiB(컨테이너 cgroup `memory.peak`), 적재 뒤에도 1.3 GiB 안팎에 머문다(JVM 이 힙을 돌려주지 않음).
