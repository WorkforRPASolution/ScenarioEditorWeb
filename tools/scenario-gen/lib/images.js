'use strict'
const { PNG } = require('pngjs')
const fs = require('node:fs')
const path = require('node:path')

const FIX = path.join(__dirname, '..', 'fixtures')
const cache = new Map()
const load = (name) => {
  if (!cache.has(name)) cache.set(name, PNG.sync.read(fs.readFileSync(path.join(FIX, `${name}.png`))))
  return cache.get(name)
}

const full = (name) => fs.readFileSync(path.join(FIX, `${name}.png`)).toString('base64')

function crop(name, [x, y, w, h]) {
  const src = load(name)
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(src, out, x, y, w, h, 0, 0)
  return PNG.sync.write(out).toString('base64')
}

// 아래쪽 띠에 결정적인 무작위 점을 넣어 압축이 덜 되게 한다. targetBytes 이상이 될 때까지 띠 높이를 늘린다.
function noisy(name, seed, targetBytes) {
  const src = load(name)
  let rows = 40
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = new PNG({ width: src.width, height: src.height })
    src.data.copy(out.data)
    let s = seed >>> 0
    for (let yy = src.height - rows; yy < src.height; yy++) {
      for (let xx = 0; xx < src.width; xx++) {
        const i = (yy * src.width + xx) * 4
        s = (Math.imul(s, 1103515245) + 12345) >>> 0
        out.data[i] = s & 255; out.data[i + 1] = (s >>> 8) & 255; out.data[i + 2] = (s >>> 16) & 255; out.data[i + 3] = 255
      }
    }
    const buf = PNG.sync.write(out)
    if (buf.length >= targetBytes || rows >= src.height) return buf.toString('base64')
    rows = Math.min(src.height, Math.ceil((rows * targetBytes) / buf.length * 1.05))
  }
  throw new Error('noisy: 목표 크기에 닿지 못함')
}

module.exports = { full, crop, noisy }
