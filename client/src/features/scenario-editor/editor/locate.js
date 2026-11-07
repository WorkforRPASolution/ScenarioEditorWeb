const SAMPLES = 64

// 찾을 그림에서 드문 색 픽셀 최대 64개(오프셋, 색)를 고른다.
function pickSamples(train) {
  const { width: w, height: h, data } = train
  const n = w * h
  const key = i => (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]
  const counts = new Map()
  for (let i = 0; i < n; i++) { const k = key(i); counts.set(k, (counts.get(k) || 0) + 1) }
  // 후보는 최대 4096개로 고르게 솎은 뒤 희귀한 순서로 64개.
  const step = Math.max(1, Math.floor(n / 4096))
  const cand = []
  for (let i = 0; i < n; i += step) cand.push(i)
  cand.sort((a, b) => counts.get(key(a)) - counts.get(key(b)) || a - b)
  return cand.slice(0, SAMPLES).map(i => {
    const p = i * 4
    return { dx: i % w, dy: (i / w) | 0, r: data[p], g: data[p + 1], b: data[p + 2] }
  })
}

// 기준 화면 base 의 area 안에서 train 과 RGB 가 모두 같은 곳을 찾는다. 좌표는 찾은 왼쪽 위.
export function locate(base, train, area, { timeLimitMs = 3000, now = () => Date.now() } = {}) {
  const x0 = Math.max(0, Math.floor(area.x)), y0 = Math.max(0, Math.floor(area.y))
  const x1 = Math.min(base.width, Math.floor(area.x + area.w)), y1 = Math.min(base.height, Math.floor(area.y + area.h))
  const tw = train.width, th = train.height
  if (!(tw > 0 && th > 0) || x1 - x0 < tw || y1 - y0 < th) return { found: 'none' }

  const bw = base.width, bd = base.data, td = train.data
  const samples = pickSamples(train)
  const start = now()
  let hit = null
  for (let y = y0; y + th <= y1; y++) {
    if (now() - start > timeLimitMs) return { found: 'timeout' }
    for (let x = x0; x + tw <= x1; x++) {
      let ok = true
      for (let s = 0; s < samples.length; s++) {
        const q = samples[s], p = ((y + q.dy) * bw + x + q.dx) * 4
        if (bd[p] !== q.r || bd[p + 1] !== q.g || bd[p + 2] !== q.b) { ok = false; break }
      }
      if (!ok) continue
      for (let ty = 0; ty < th && ok; ty++) {
        let bp = ((y + ty) * bw + x) * 4, tp = ty * tw * 4
        for (let tx = 0; tx < tw; tx++, bp += 4, tp += 4) {
          if (bd[bp] !== td[tp] || bd[bp + 1] !== td[tp + 1] || bd[bp + 2] !== td[tp + 2]) { ok = false; break }
        }
      }
      if (!ok) continue
      if (hit) return { found: 'many' }
      hit = { x, y }
    }
  }
  return hit ? { found: 'one', ...hit } : { found: 'none' }
}
