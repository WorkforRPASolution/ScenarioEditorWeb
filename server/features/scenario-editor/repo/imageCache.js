'use strict'
// 버전 풀기 결과(뼈대 + PNG) 디스크 캐시. 버전 단위 디렉터리, 완료 표시 .done, 용량 상한을 넘으면 오래 안 쓴 버전부터 지운다.
const fsp = require('node:fs/promises')
const path = require('node:path')

const ID = /^[a-z0-9-]+$/

function createImageCache({ dir, maxBytes }) {
  const vdir = (key) => path.join(dir, encodeURIComponent(key))
  const done = (key) => path.join(vdir(key), '.done')

  async function touch(key) {
    const now = new Date()
    await fsp.utimes(done(key), now, now).catch(() => {})
  }

  async function readSkeleton(key) {
    try {
      await fsp.access(done(key))
      const text = await fsp.readFile(path.join(vdir(key), 'skeleton.json'), 'utf8')
      await touch(key)
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  async function sizeOf(d) {
    let total = 0
    for (const f of await fsp.readdir(d)) total += (await fsp.stat(path.join(d, f))).size
    return total
  }

  async function evict() {
    let entries = []
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      const d = path.join(dir, name)
      const st = await fsp.stat(path.join(d, '.done')).catch(() => null)
      entries.push({ d, used: st ? st.mtimeMs : 0, size: await sizeOf(d).catch(() => 0) })
    }
    let total = entries.reduce((a, e) => a + e.size, 0)
    entries = entries.sort((a, b) => a.used - b.used)
    for (const e of entries) {
      if (total <= maxBytes) break
      await fsp.rm(e.d, { recursive: true, force: true })
      total -= e.size
    }
  }

  async function store(key, skeleton, images) {
    const d = vdir(key)
    await fsp.rm(d, { recursive: true, force: true })
    await fsp.mkdir(d, { recursive: true })
    // 뼈대가 같은 id 를 두 번 낼 수 있다(예: TrainImageMap 키 '1' 과 '01'). 내용이 같으니 처음 것만 쓴다.
    const written = new Set()
    for (const img of images) {
      if (!ID.test(img.id)) throw new Error(`이미지 id 형식 오류: ${img.id}`)
      if (written.has(img.id)) continue
      written.add(img.id)
      await fsp.writeFile(path.join(d, `${img.id}.png`), Buffer.from(img.base64, 'base64'))
    }
    await fsp.writeFile(path.join(d, 'skeleton.json'), JSON.stringify(skeleton))
    await fsp.writeFile(done(key), '')
    await evict()
  }

  async function imagePath(key, imageId) {
    if (!ID.test(imageId)) return null
    const p = path.join(vdir(key), `${imageId}.png`)
    try {
      await fsp.access(done(key))
      await fsp.access(p)
      await touch(key)
      return p
    } catch {
      return null
    }
  }

  async function clear() {
    await fsp.rm(dir, { recursive: true, force: true })
  }

  return { readSkeleton, store, imagePath, clear }
}

module.exports = { createImageCache }
