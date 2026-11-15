'use strict'
// 이력 서버(HttpWebServer) `GET /ARS/History/{설비}/{txn}` 의 HTML 에서 스텝·설명·그림만 뽑는다 (P3 설계 §5.6).
// 이력 서버의 HTML 은 화면에 넣지 않는다 — 여기서 뽑은 글자와 PNG 데이터 주소만 나간다.
//
// 본문은 스텝마다 아래 조각을 이어 붙인 것이다(HttpWebServer HttpWorker.scala 의 AddHistory):
//   <table bgColor=#308cfc><tbody><tr><th><strong>{스텝}.{설명}</strong><img … src="data:Image/png;base64,{기준 그림}" …/></th></tr>
//   <tr><td …><img src="data:Image/png;base64,{화면}" …/></td></tr></tbody></table><br>
// - 설명은 이력 서버가 받은 글을 이스케이프 없이 넣은 것이다. 태그처럼 보여도 글자로 그대로 준다(화면이 글자로만 그린다).
//   글의 끝은 `</th>` 앞의 마지막 `</strong>` 이다 — 설명 안에 `</strong>`·`<img` 가 있어도 글에 든다.
// - 그림은 글 뒤의 `<img src="data:image/png;base64,…">` 만(접두사 대소문자 무시 — 이력 서버는 `data:Image/png` 로 쓴다).
//   `</th>` 앞이면 기준 그림(ref), 뒤면 판정 때의 화면(screen). 값이 base64 글자가 아니거나 너무 짧으면(그림이 없을 때의 `null` 등) 그 그림만 뺀다.
const PREFIX = /^data:image\/png;base64,/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const MIN_BASE64 = 16 // PNG 서명만 해도 11자 — 이보다 짧으면 그림이 아니다(`null`)
const OUT_PREFIX = 'data:image/png;base64,'

const indexOfCI = (s, needle, from = 0) => s.toLowerCase().indexOf(needle, from)
const lastIndexOfCI = (s, needle) => s.toLowerCase().lastIndexOf(needle)

function imagesOf(rest) {
  const thEnd = indexOfCI(rest, '</th>')
  const out = []
  const tag = /<img\b[^>]*>/gi
  let m
  let order = 0
  while ((m = tag.exec(rest)) !== null) {
    const kind = thEnd >= 0 ? (m.index < thEnd ? 'ref' : 'screen') : order === 0 ? 'ref' : 'screen'
    order++
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(m[0])
    if (!src || !PREFIX.test(src[1])) continue
    const payload = src[1].replace(PREFIX, '')
    if (payload.length < MIN_BASE64 || !BASE64.test(payload)) continue
    out.push({ kind, src: OUT_PREFIX + payload })
  }
  return out
}

function stepOf(piece) {
  const open = indexOfCI(piece, '<strong>')
  if (open < 0) return null
  const from = open + '<strong>'.length
  const thEnd = indexOfCI(piece, '</th>', from)
  const head = thEnd >= 0 ? piece.slice(from, thEnd) : piece.slice(from)
  const close = lastIndexOfCI(head, '</strong>')
  if (close < 0) return null
  const raw = head.slice(0, close)
  const numbered = /^\s*(\d{1,9})\.([\s\S]*)$/.exec(raw)
  return {
    no: numbered ? Number(numbered[1]) : null,
    text: (numbered ? numbered[2] : raw).trim(),
    images: imagesOf(piece.slice(from + close + '</strong>'.length))
  }
}

function parseHistoryHtml(html) {
  if (typeof html !== 'string') return []
  const steps = []
  // 첫 조각 앞(머리·스타일)은 버린다
  for (const piece of html.split(/<table\b/i).slice(1)) {
    const step = stepOf(piece)
    if (step) steps.push(step)
  }
  return steps
}

module.exports = { parseHistoryHtml }
