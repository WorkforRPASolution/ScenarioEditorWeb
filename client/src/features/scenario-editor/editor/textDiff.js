// 바뀐 값 글(이전 → 지금)에서 실제로 바뀐 부분 찾기 — 긴 명령·키 입력·인자에서 한두 글자만 바뀐 곳을 색으로 보이게 한다.
// 숫자는 통째로 한 덩어리(12 → 15 를 1[2] → 1[5] 로 쪼개지 않는다), 나머지는 글자(코드 포인트) 단위로 견준다.
// 겹치는 글이 거의 없으면(MIN_COMMON 자 미만) 색을 넣지 않는다 — "켜짐 → 꺼짐" 같은 고른 값은 통째로 바뀐 것이다.

const TOKEN = /\d+(?:\.\d+)?|[\s\S]/gu
const MIN_COMMON = 3 // 같은 글이 이만큼은 있어야 "일부만 바뀜" 이다. 바뀐 곳 사이에 낀 같은 글도 이보다 짧으면 바뀐 부분에 합친다
const MAX_CELLS = 250000 // 가운데(앞뒤 같은 부분을 뺀 나머지) 토큰 수의 곱 — 넘으면 가운데를 통째로 바뀐 부분으로 본다

const whole = (text) => (text === '' ? [] : [{ text, changed: false }])

// 가장 긴 공통 부분열로 a·b 토큰마다 같은지(true) 표시한다
function lcsMarks(a, b) {
  const n = a.length
  const m = b.length
  const keepA = new Array(n).fill(false)
  const keepB = new Array(m).fill(false)
  if (!n || !m || n * m > MAX_CELLS) return [keepA, keepB]
  const w = m + 1
  const dp = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { keepA[i++] = true; keepB[j++] = true } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  return [keepA, keepB]
}

// 같은 토큰끼리 짝을 지어 [{ a: [시작, 끝), b: [시작, 끝), same }] 구간으로 묶는다
function runs(keepA, keepB) {
  const out = []
  let i = 0
  let j = 0
  const n = keepA.length
  const m = keepB.length
  while (i < n || j < m) {
    const si = i
    const sj = j
    if (i < n && j < m && keepA[i] && keepB[j]) {
      while (i < n && j < m && keepA[i] && keepB[j]) { i++; j++ }
      out.push({ a: [si, i], b: [sj, j], same: true })
    } else {
      while (i < n && !keepA[i]) i++
      while (j < m && !keepB[j]) j++
      out.push({ a: [si, i], b: [sj, j], same: false })
    }
  }
  return out
}

const join = (tokens, [from, to]) => tokens.slice(from, to).join('')

function partsOf(tokens, list, side) {
  const out = []
  for (const r of list) {
    const text = join(tokens, r[side])
    if (text === '') continue
    const last = out[out.length - 1]
    if (last && last.changed === !r.same) last.text += text
    else out.push({ text, changed: !r.same })
  }
  return out
}

// → { before: [{ text, changed }], after: [{ text, changed }] } — 조각을 이으면 원래 글이다
export function diffParts(before, after) {
  const x = String(before ?? '')
  const y = String(after ?? '')
  const plain = { before: whole(x), after: whole(y) }
  if (x === y || x === '' || y === '') return plain
  const a = x.match(TOKEN)
  const b = y.match(TOKEN)
  // 앞뒤 같은 부분을 먼저 뺀다(긴 글도 가운데만 견준다)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const [midA, midB] = lcsMarks(a.slice(head, a.length - tail), b.slice(head, b.length - tail))
  const keepA = [...new Array(head).fill(true), ...midA, ...new Array(tail).fill(true)]
  const keepB = [...new Array(head).fill(true), ...midB, ...new Array(tail).fill(true)]
  const list = runs(keepA, keepB)
  // 바뀐 곳 사이에 낀 짧은 같은 글은 바뀐 부분으로 — 색이 글자마다 조각나지 않게
  list.forEach((r, k) => {
    if (r.same && k > 0 && k < list.length - 1 && join(a, r.a).length < MIN_COMMON) r.same = false
  })
  const common = list.reduce((sum, r) => sum + (r.same ? join(a, r.a).length : 0), 0)
  if (common < MIN_COMMON) return plain
  return { before: partsOf(a, list, 'a'), after: partsOf(b, list, 'b') }
}
