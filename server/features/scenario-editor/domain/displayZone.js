'use strict'
// 시간대 설정값 읽기 — 스냅샷 표시 시각(SE_DISPLAY_TZ)·그림 파티션 날짜(SE_SNAPSHOT_PARTITION_TZ)·메모의 쓴 때가 함께 쓴다.
// 값이 틀리면 기본값으로 돌리고 알린다(틀린 채로 두면 요청마다 Intl 이 던진다). 서비스를 만들 때 한 번만 부른다.
const DEFAULT_TZ = 'Asia/Seoul'

function zoneOf(env, name, log = null) {
  const v = env && typeof env[name] === 'string' ? env[name].trim() : ''
  if (!v) return DEFAULT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return v
  } catch {
    if (log) log.warn(`${name} 값을 시간대로 읽지 못해 ${DEFAULT_TZ} 를 씁니다`)
    return DEFAULT_TZ
  }
}

module.exports = { zoneOf, DEFAULT_TZ }
