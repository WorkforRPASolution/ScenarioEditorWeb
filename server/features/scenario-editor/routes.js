const express = require('express')
const { authenticate } = require('../../shared/middleware/authMiddleware')
const { asyncHandler } = require('../../shared/middleware/errorHandler')
const c = require('./controller')
const { multipartMeta } = require('./upload')
const { testUpload } = require('./testUpload')

const router = express.Router()
router.use(authenticate)
router.use(asyncHandler(c.loadUser))

router.get('/me', asyncHandler(c.me))
router.get('/scopes', asyncHandler(c.scopes))
router.get('/links', asyncHandler(c.links)) // 안내 문서 링크(P2-F) — 설정값이 없으면 null
router.post('/cache/refresh', asyncHandler(c.refreshCache))
router.get('/data-check', asyncHandler(c.dataCheck))
router.post('/check', c.requireWrite, asyncHandler(c.check))
router.post('/drafts', c.requireWrite, multipartMeta, asyncHandler(c.saveDraft))
router.get('/drafts', asyncHandler(c.listDrafts))
router.get('/drafts/:id', asyncHandler(c.getDraft))
router.get('/drafts/:id/images/:tempId', asyncHandler(c.draftImage))
router.delete('/drafts/:id', c.requireWrite, asyncHandler(c.removeDraft))
router.post('/deploy', c.requireWrite, multipartMeta, asyncHandler(c.deploy))
router.post('/deploy/:requestId/verify', c.requireWrite, asyncHandler(c.deployVerify))
router.post('/deploy/:requestId/finish', c.requireWrite, asyncHandler(c.deployFinish))
router.put('/scenarios/:process/:model/:name/enabled', c.requireWrite, asyncHandler(c.setEnabled))
router.delete('/scenarios/:process/:model/:name', c.requireWrite, asyncHandler(c.removeScenario))
router.put('/scenarios/:process/:model/:name/review', c.requireReviewer, asyncHandler(c.reviewScenario))
router.put('/scenarios/:process/:model/:name/performance', c.requireReviewer, asyncHandler(c.savePerformance))
router.get('/scenarios/:process/same-name/:name', asyncHandler(c.sameName))
router.get('/users', c.requireReviewer, asyncHandler(c.searchUsers)) // 원개발자 찾기(?q=)·등록 여부(?ids=) — 성과 입력 창(등급 1·2) 몫(설계 §8 403)
router.get('/name-rule', asyncHandler(c.nameRule))
router.get('/scenarios', asyncHandler(c.list))
router.get('/scenario-counts', asyncHandler(c.counts)) // 불러오기 창의 공정·모델 옆 (내 초안 | 시나리오) 수
router.get('/scenarios/:process/:model/:name/versions', asyncHandler(c.versions))
router.get('/scenarios/:process/:model/:name/versions/:crtime', asyncHandler(c.open))
router.get('/scenarios/:process/:model/:name/versions/:crtime/files/:fileId/images/:imageId', asyncHandler(c.image))
// 스냅샷(P3) — 읽기. 설비 범위는 서비스가 본다(403 EQP_FORBIDDEN).
router.get('/equipment', asyncHandler(c.equipment))
router.get('/snapshots/presence', asyncHandler(c.snapshotPresence)) // 설비마다 가장 늦은 날짜 — 설비 고르기의 유무 표시
router.get('/snapshots/days', asyncHandler(c.snapshotDays))
router.get('/snapshots', asyncHandler(c.snapshotList))
router.get('/snapshots/:eqpId/:fileName/image', asyncHandler(c.snapshotImage))
// 스냅샷 메모(P3-C) — WRITE 권한을 보지 않는다(그 설비의 스냅샷을 볼 수 있으면 쓴다). 서버가 쓰기를 받지 않을 때만 막는다.
router.put('/snapshots/:eqpId/:fileName/memo', c.requireMemoWrite, asyncHandler(c.saveMemo))
router.delete('/snapshots/:eqpId/:fileName/memo', c.requireMemoWrite, asyncHandler(c.removeMemo))
router.get('/memos', asyncHandler(c.memoList))
// 자동 복구 이력(P3-D) — 이력 서버(HttpWebServer)의 HTML 에서 뽑은 스텝·설명·그림. 태그 스냅샷의 txn(99999 이상)으로 부른다.
router.get('/history/:eqpId/:txn', asyncHandler(c.history))
// Vision·OCR 시험(P4) — 편집 중인 스텝의 조건을 판정 서버에 물어 본다. 등록된 사용자면 된다:
// WRITE 권한·읽기 전용 서버(seWriteDisabled)를 보지 않는다(아무것도 쓰지 않는다, 사내 데스크톱도 누구나 시험한다). 부담은 서비스가 동시 수로 묶는다.
router.post('/vision-test', testUpload(['source', 'train']), asyncHandler(c.visionTest))
router.post('/ocr-test', testUpload(['source']), asyncHandler(c.ocrTest))
// 시험 실행(P5) — 설비에 시나리오 실행을 요청한다. 실제 설비를 움직이는 일이라 쓰기로 본다:
// WRITE + 서버 스위치(SE_TEST_RUN=1) + 읽기 전용 서버가 아님 + (EARS 가 이 PC 밖이면) 사용자 바꾸기가 꺼져 있음. 설비·시나리오 검사는 서비스가 요청마다 다시 한다.
router.get('/test-run/equipment', c.requireTestRun, asyncHandler(c.testRunEquipment)) // 고른 공정·모델의 설비(자동조치 지금 값)
router.get('/test-run/scenario', c.requireTestRun, asyncHandler(c.testRunScenario)) // 시나리오 하나의 실행 정보(막는 까닭·운영 속성·현재 판·방금 요청)
router.post('/test-run/requests', c.requireTestRun, asyncHandler(c.testRunRequest)) // 설비 한 대에 실행 요청
router.post('/test-run/status', c.requireTestRun, asyncHandler(c.testRunStatus)) // 내 실행(runId)의 요청 결과와 실행 상태

module.exports = router
