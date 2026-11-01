# 시험 데이터 적재

- `npm run seed -- reset basic anomaly` — SEW 데이터를 지우고 설비·사용자·시나리오를 다시 넣는다.
- `npm run seed -- big` — 큰 시나리오(BIG_200)만 더 넣는다(지우지 않음, 약 40초).
- `npm run seed -- clean` — SEW 데이터만 지운다.
- 2026-11-01 기준 적재 결과(`reset basic anomaly`, 약 1초): SC_PROPERTY SEW 23 · fs.files SEW 24 · Redis DB0 키 6개(`SEW{CVD,ETCH,PHOTO}-SEWMODEL{A,B}`) · 설비 12(AGENT_INFO 13) · 사용자 6. 공유 로컬 EARS 의 SEW 가 아닌 EQP_INFO 82건은 그대로.
- 시나리오 해시는 Redis DB0 에서 확인했다(설계 §3.1).
- `npm run seed -- big` (2026-11-01): `big/BIG_200 setscenario crtime=1793535641775` — HTTP 200, askTimeout 없음. setscenario 6.7초(명령 전체 37.7초, 대부분은 110MB BI 생성). 적재 후 SC_PROPERTY SEW 24 · fs.files SEW 25(BIG_200 114,881,881바이트, 청크 110개) · `SEWPHOTO-SEWMODELA` 해시 필드 4개.
- InterfaceServer 힙: 처음 `-Xmx512m`/`mem_limit: 768m` 에서는 요청 본문(110.5MB)을 문자열로 바꾸다 `OutOfMemoryError: Java heap space` 로 JVM 이 종료돼 실패했다. `-Xmx1536m`/`mem_limit: 2g`(`infra/docker-compose.yml`)로 올려 성공: 막 올렸을 때 405 MiB, 적재 중·뒤 최고 약 1500 MiB(컨테이너 cgroup `memory.peak`), 적재 뒤에도 1.3 GiB 안팎에 머문다(JVM 이 힙을 돌려주지 않음).
