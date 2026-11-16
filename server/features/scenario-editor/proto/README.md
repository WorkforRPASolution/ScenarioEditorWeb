# proto

`vision.proto` 는 InterfaceServer 의 gRPC 계약 사본이다. **고치지 않는다** — 웹 백엔드는 이 파일로 InterfaceServer 의 판정 창구(`VISION_PORT`)를 부른다(`clients/visionClient.js`, P4 설계 §5.1).

| 무엇 | 값 |
|---|---|
| 출처 | 작업 공간 `InterfaceServer` 저장소 `src/main/proto/vision.proto` |
| 가져온 때의 커밋 | `a33e54c`(2026-11-16). 이 파일을 마지막으로 고친 커밋은 `dcde526`(2026-10-02) |
| sha256 | `ba5c403be46f2a4166ba4bc0167d608ca52f1b135c688412c3103f92ae589296` |

- 사내 편집기의 생성 코드와 wire 구조가 같다(메시지 12개·필드 41개·RPC 5개 — 분석 42 Q-062, 2026-11-03).
- 웹이 쓰는 RPC 는 `RequestVision`·`RequestOcr` 둘이다. 필드 이름은 섞여 있는 그대로 쓴다(`sourceImage`·`AcceptThreshold`·`TX` — `keepCase`).
- 시험 `__tests__/visionProto.test.js` 가 위 sha256 과, 작업 공간에 InterfaceServer 저장소가 있으면 그 파일과도 견준다.
- 다시 가져올 때: 파일을 바이트 그대로 복사하고 이 표의 커밋·sha256 을 고친다. 편입 때는 기능 폴더와 함께 옮긴다.
