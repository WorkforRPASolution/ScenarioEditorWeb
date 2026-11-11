'use strict'
// 스냅샷 시험 데이터 배치 (P3 설계 §11). 시각은 KST 벽시계 'HH:mm:ss.fff'.
const PHOTO = 'SEWT_PHOTO_A01' // 주 설비 (SEWPHOTO)
const CVD = 'SEWT_CVD_A01' // 다른 공정 설비 (SEWCVD) — 권한 확인용
const WIDTH = 640
const HEIGHT = 360

// 오늘 클릭 12장 — 근무조 경계(06·14·22시)를 걸친다. [시각, x, y]
const TODAY_CLICKS = [
  ['00:30:10.100', 40, 50], ['02:15:20.200', 120, 80], ['05:59:59.300', 200, 110], ['06:00:00.000', 280, 140],
  ['08:10:11.400', 360, 170], ['09:13:02.004', 412, 288], ['11:45:30.500', 520, 200], ['13:59:59.999', 600, 230],
  ['14:00:00.000', 80, 260], ['17:20:40.600', 160, 290], ['21:59:59.700', 240, 320], ['22:00:00.000', 320, 350]
]
// 오늘 태그 한 벌 — txn 은 첫 줄(시작)의 ms. [시각, 코드]
const TODAY_TAGS = [
  ['10:00:00.000', 9999], ['10:00:10.000', 9993], ['10:00:20.000', 9992], ['10:00:30.000', 9991], ['10:00:40.000', 9990]
]
const TODAY_SAME_MS = { time: '15:30:00.000', click: [300, 150], tagCode: 9999 } // 같은 ms 에 클릭과 태그
const TODAY_LIST_ONLY = ['16:00:00.000', 10, 10] // 목록에만 있고 그림이 없다
const YESTERDAY_CLICKS = [['09:00:00.000', 100, 100], ['15:00:00.000', 200, 200], ['23:00:00.000', 300, 300]]
const OLD_CLICK = { daysAgo: 14.5, x: 50, y: 60 } // 지금 기준 — "1일 뒤 삭제"
const CVD_TODAY_CLICKS = [['09:30:00.000', 111, 222], ['18:30:00.000', 333, 44]]

module.exports = {
  PHOTO, CVD, WIDTH, HEIGHT, TODAY_CLICKS, TODAY_TAGS, TODAY_SAME_MS, TODAY_LIST_ONLY, YESTERDAY_CLICKS, OLD_CLICK, CVD_TODAY_CLICKS
}
