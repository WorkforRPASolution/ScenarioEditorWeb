'use strict'
// 버전 풀기 결과(뼈대 + PNG) 디스크 캐시. 버전 단위 디렉터리, 완료 표시 .done, 용량 상한을 넘으면 오래 안 쓴 버전부터 지운다.
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')

const ID = /^[a-z0-9-]+$/
const MAX_NAME = 200 // 인코딩한 디렉터리 이름이 이보다 길면(한글 시나리오 이름 등) 해시 이름을 쓴다(파일 이름 한도 255 바이트)

// 키 -> 디렉터리 이름. 같은 키는 항상 같은 이름이고 저장·읽기가 모두 이 함수를 쓴다.
// 빈 키와 '.'·'..' 는 캐시 밖(부모)을 가리키므로 디스크를 건드리기 전에 거부한다.
// encodeURIComponent 가 남기는 문자 중 * 는 Windows 파일 이름에 못 쓰므로 %2A 로 바꾼다.
// encodeURIComponent 는 %2A 를 내지 않으므로(% 는 %25 가 된다) 다른 키와 겹치지 않는다.
function dirName(key) {
  if (typeof key !== 'string') throw new Error('캐시 키 형식 오류')
  const enc = encodeURIComponent(key).replace(/\*/g, '%2A')
  if (enc === '' || enc === '.' || enc === '..') throw new Error(`캐시 키 형식 오류: ${JSON.stringify(key)}`)
  return enc.length <= MAX_NAME ? enc : `~${crypto.createHash('sha256').update(key).digest('hex')}`
}

function createImageCache({ dir, maxBytes }) {
  const vdir = (key) => path.join(dir, dirName(key))
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
    for (const f of await fsp.readdir(d).catch(() => [])) {
      const st = await fsp.stat(path.join(d, f)).catch(() => null)
      if (st) total += st.size
    }
    return total
  }

  // 용량 상한을 넘으면 완료된(.done 있는) 버전을 오래 안 쓴 순으로 지운다.
  // 저장 중이거나 끊긴 디렉터리(.done 없음)와 방금 저장한 버전(keep)은 지우지 않는다 — 혼자서 상한을 넘으면 넘은 채로 둔다.
  // 용량 정리는 덤이라 어떤 오류도 store 를 실패시키지 않는다.
  async function evict(keep) {
    try {
      const entries = []
      for (const name of await fsp.readdir(dir)) {
        const d = path.join(dir, name)
        const st = await fsp.stat(path.join(d, '.done')).catch(() => null)
        entries.push({ name, d, finished: st !== null, used: st ? st.mtimeMs : 0, size: await sizeOf(d) })
      }
      let total = entries.reduce((a, e) => a + e.size, 0)
      const victims = entries.filter((e) => e.finished && e.name !== keep).sort((a, b) => a.used - b.used)
      for (const e of victims) {
        if (total <= maxBytes) break
        try {
          await fsp.rm(e.d, { recursive: true, force: true })
          total -= e.size
        } catch {
          // 이 버전은 못 지웠다. 다음 후보로 넘어간다.
        }
      }
    } catch {
      // 목록을 못 읽었다. 다음 store 에서 다시 정리한다.
    }
  }

  async function store(key, skeleton, images) {
    const d = vdir(key) // 특수 키는 여기서 던진다
    for (const img of images) {
      if (!img || typeof img.id !== 'string' || !ID.test(img.id)) throw new Error(`이미지 id 형식 오류: ${img && img.id}`)
    }
    await fsp.rm(d, { recursive: true, force: true })
    await fsp.mkdir(d, { recursive: true })
    // 뼈대가 같은 id 를 두 번 낼 수 있다(예: TrainImageMap 키 '1' 과 '01'). 내용이 같으니 처음 것만 쓴다.
    const written = new Set()
    for (const img of images) {
      if (written.has(img.id)) continue
      written.add(img.id)
      await fsp.writeFile(path.join(d, `${img.id}.png`), Buffer.from(img.base64, 'base64'))
    }
    await fsp.writeFile(path.join(d, 'skeleton.json'), JSON.stringify(skeleton))
    await fsp.writeFile(done(key), '')
    await evict(path.basename(d))
  }

  async function imagePath(key, imageId) {
    if (!ID.test(imageId)) return null
    try {
      const p = path.join(vdir(key), `${imageId}.png`)
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
