'use strict'
// 이력 서버(HttpWebServer) `GET /ARS/History/{설비}/{txn}` 의 HTML 에서 스텝·설명·그림만 뽑는다 (P3 설계 §5.6).
// 이력 서버의 HTML 은 화면에 넣지 않는다 — 여기서 뽑은 글자와 PNG 데이터 주소만 나간다.
//
// 본문은 스텝마다 아래 조각을 이어 붙인 것이다(HttpWebServer HttpWorker.scala 의 AddHistory):
//   <table bgColor=#308cfc><tbody><tr><th><strong>{스텝}.{설명}</strong><img … src="data:Image/png;base64,{기준 그림}" …/></th></tr>
//   <tr><td …><img src="data:Image/png;base64,{화면}" …/></td></tr></tbody></table><br>
// - 설명은 이력 서버가 받은 글을 이스케이프 없이 넣은 것이다(넣는 입구에 인증이 없다). 태그처럼 보여도 글자로 그대로 준다(화면이 글자로만 그린다).
// - 조각은 머리 `<tbody><tr><th><strong>` 로 나눈다. 설명 뒤쪽(그림 둘·닫는 태그)은 이력 서버가 만든 것이라 `</th>` 가 하나뿐이다 —
//   조각의 **마지막** `</th>` 가 머리 칸의 끝이고, 그 앞의 **마지막** `</strong>` 이 설명의 끝이다.
//   그래서 설명 안에 `<table`·`</th>`·`</strong>`·`<img` 가 있어도 설명에 든다(스텝이 사라지거나 그림으로 세지 않는다).
// - 그림은 설명 뒤의 `<img … src="data:image/png;base64,…">` 만(접두사 대소문자 무시 — 이력 서버는 `data:Image/png` 로 쓴다).
//   마지막 `</th>` 앞이면 기준 그림(ref), 뒤면 판정 때의 화면(screen). 값이 base64 글자가 아니거나 너무 짧으면(그림이 없을 때의 `null` 등) 그 그림만 뺀다.
// - 정규식으로 글 전체를 훑지 않는다. 글자 찾기(indexOf)로 앞에서 뒤로 한 번만 간다 — 닫히지 않는 태그가 많은 글 하나가 서버를 멈추지 않게(독립 검토).
const HEAD = '<tbody><tr><th><strong>'
const TEXT_END = '</strong>'
const HEAD_END = '</th>'
const PREFIX = /^data:image\/png;base64,/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const MIN_BASE64 = 16 // PNG 서명만 해도 11자 — 이보다 짧으면 그림이 아니다(`null`)
const OUT_PREFIX = 'data:image/png;base64,'
const SRC = 'src="'

// region 안의 <img …> 를 앞에서부터. 닫는 꺾쇠가 더 없으면 멈춘다.
function imagesOf(region, kind, out) {
  let at = 0
  for (;;) {
    const open = region.indexOf('<img', at)
    if (open < 0) return
    const close = region.indexOf('>', open)
    if (close < 0) return
    at = close + 1
    const s = region.indexOf(SRC, open)
    if (s < 0 || s > close) continue
    const from = s + SRC.length
    const quote = region.indexOf('"', from)
    if (quote < 0 || quote > close) continue
    const value = region.slice(from, quote)
    if (!PREFIX.test(value)) continue
    const payload = value.slice(OUT_PREFIX.length)
    if (payload.length < MIN_BASE64 || !BASE64.test(payload)) continue
    out.push({ kind, src: OUT_PREFIX + payload })
  }
}

// piece = 머리 바로 뒤부터 다음 머리 앞까지
function stepOf(piece) {
  const headEnd = piece.lastIndexOf(HEAD_END)
  if (headEnd < 0) return null
  const textEnd = piece.lastIndexOf(TEXT_END, headEnd)
  if (textEnd < 0) return null
  const raw = piece.slice(0, textEnd)
  const numbered = /^\s*(\d{1,9})\./.exec(raw)
  const images = []
  imagesOf(piece.slice(textEnd + TEXT_END.length, headEnd), 'ref', images)
  imagesOf(piece.slice(headEnd), 'screen', images)
  return { no: numbered ? Number(numbered[1]) : null, text: (numbered ? raw.slice(numbered[0].length) : raw).trim(), images }
}

function parseHistoryHtml(html) {
  if (typeof html !== 'string') return []
  const steps = []
  let at = html.indexOf(HEAD)
  while (at >= 0) {
    const from = at + HEAD.length
    const next = html.indexOf(HEAD, from)
    const step = stepOf(next < 0 ? html.slice(from) : html.slice(from, next))
    if (step) steps.push(step)
    at = next
  }
  return steps
}

module.exports = { parseHistoryHtml }
