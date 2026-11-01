# 시험 데이터 적재

- `npm run seed -- reset basic anomaly` — SEW 데이터를 지우고 설비·사용자·시나리오를 다시 넣는다.
- `npm run seed -- big` — 큰 시나리오(BIG_200)만 더 넣는다(지우지 않음, 수 분).
- `npm run seed -- clean` — SEW 데이터만 지운다.
- 2026-11-01 기준 적재 결과(`reset basic anomaly`, 약 1초): SC_PROPERTY SEW 23 · fs.files SEW 24 · Redis DB0 키 6개(`SEW{CVD,ETCH,PHOTO}-SEWMODEL{A,B}`) · 설비 12(AGENT_INFO 13) · 사용자 6. 공유 로컬 EARS 의 SEW 가 아닌 EQP_INFO 82건은 그대로.
- 시나리오 해시는 Redis DB0 에서 확인했다(설계 §3.1).
- `npm run seed -- big` 은 2026-11-01 에 **실패**했다: BIG_200 의 setscenario 요청 본문이 110.5MB 라서 InterfaceServer(`-Xmx512m`, 컨테이너 768MB)가 본문을 문자열로 바꾸는 중 `OutOfMemoryError: Java heap space` 로 JVM 이 종료됐다(저장된 것 없음). 이 크기를 받으려면 InterfaceServer 의 힙을 늘려야 한다 — 컨테이너 설정은 이 도구가 건드리지 않는다.
