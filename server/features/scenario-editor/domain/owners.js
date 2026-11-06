'use strict'
// Owners 줄 만들기(설계 §6, 13 §2.5·§418). 시각은 KST(UTC+9 고정, 서머타임 없음).
const KST_MS = 9 * 3600 * 1000
const pad = (n) => String(n).padStart(2, '0')

function kstDate(date) {
  const d = new Date(date.getTime() + KST_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function kstStamp(date) {
  const d = new Date(date.getTime() + KST_MS)
  return `${kstDate(date)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

const deployLine = (singleid, date) => `${singleid}@${kstStamp(date)}`
const toggleLine = (singleid, date, enabled) =>
  `${deployLine(singleid, date)}@${enabled ? 'Scenario Activated' : 'Scenario Deactivated'}`

// 같은 줄이 이미 있으면 그대로 복사. 아니면 max 이상일 때 맨 앞 하나만 빼고 끝에 붙인다(사내와 같음 — 50 을 넘은 목록은 길이 유지).
function ownersWithLine(current, line, max = 50) {
  const list = Array.isArray(current) ? current : []
  if (list.includes(line)) return [...list]
  return list.length >= max ? [...list.slice(1), line] : [...list, line]
}

module.exports = { kstStamp, kstDate, deployLine, toggleLine, ownersWithLine }
