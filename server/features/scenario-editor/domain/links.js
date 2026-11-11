'use strict'
// 안내 문서 링크(P2-F 설계 §8). 단독판은 환경 변수로 받고, 편입 뒤에는 WebManager 설정으로 옮긴다.
// http·https 주소만 받는다 — 그 밖의 값(javascript:·file:·호스트 없음)은 없는 것으로 보고 변수 이름을 돌려준다(시작 로그에 알린다).
const LINK_ENV = Object.freeze({ preprocessingSop: 'SE_LINK_PREPROCESSING_SOP' })

function httpUrlOrNull(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!/^https?:\/\/[^\s/?#]/i.test(v) || /\s/.test(v)) return null
  try {
    const u = new URL(v)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? v : null
  } catch { return null }
}

function linksFromEnv(env = {}) {
  const links = {}
  const invalid = []
  for (const [key, name] of Object.entries(LINK_ENV)) {
    const raw = env[name]
    links[key] = httpUrlOrNull(raw)
    if (links[key] === null && typeof raw === 'string' && raw.trim() !== '') invalid.push(name)
  }
  return { links, invalid }
}

module.exports = { linksFromEnv, LINK_ENV }
