'use strict'
// 버전 풀기 결과(뼈대 + PNG) 디스크 캐시. 버전 단위 디렉터리, 완료 표시 .done, 용량 상한을 넘으면 오래 안 쓴 버전부터 지운다.
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')

const ID = /^[a-z0-9-]+$/
const MAX_NAME = 200 // 인코딩한 디렉터리 이름이 이보다 길면(한글 시나리오 이름 등) 해시 이름을 쓴다(파일 이름 한도 255 바이트)
// 디렉터리 지우기 — Windows 에서는 백신·색인기가 파일을 잠깐 잡으면 EBUSY·EPERM·ENOTEMPTY 로 실패하므로 다시 시도한다(사내 PC 는 Windows, SEW-006).
// Node 는 recursive 일 때만 maxRetries 를 듣는다(retryDelay 씩 늘려 기다린다).
const RM_DIR = Object.freeze({ recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

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
  const active = new Set() // 지금 쓰는 중인 디렉터리 이름 — sweepUnfinished 가 건드리지 않는다

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
  // 끊긴 디렉터리는 서버를 띄울 때 sweepUnfinished 가 치운다.
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
          await fsp.rm(e.d, RM_DIR)
          total -= e.size
        } catch {
          // 이 버전은 못 지웠다. 다음 후보로 넘어간다.
        }
      }
    } catch {
      // 목록을 못 읽었다. 다음 store 에서 다시 정리한다.
    }
  }

  // 판 하나를 쓰기 시작한다. 완료 표시(.done)는 commit 때 쓰므로 그 전에는 없는 판이다.
  // 디렉터리는 처음 쓸 때 비우고 만든다 — id 가 틀리면 디스크를 건드리지 않는다.
  function begin(key) {
    const d = vdir(key) // 특수 키는 여기서 던진다
    const name = path.basename(d)
    active.add(name)
    const written = new Set()
    let prepared = null
    const prepare = () => {
      if (!prepared) prepared = fsp.rm(d, RM_DIR).then(() => fsp.mkdir(d, { recursive: true }))
      return prepared
    }
    const checkId = (id) => {
      if (typeof id !== 'string' || !ID.test(id)) throw new Error(`이미지 id 형식 오류: ${id}`)
    }
    async function writeImage(id, base64) {
      checkId(id)
      // 뼈대가 같은 id 를 두 번 낼 수 있다(예: TrainImageMap 키 '1' 과 '01'). 내용이 같으니 처음 것만 쓴다.
      if (written.has(id)) return
      written.add(id)
      await prepare()
      await fsp.writeFile(path.join(d, `${id}.png`), Buffer.from(base64, 'base64'))
    }
    return {
      writeImage,
      async removeImages(ids) {
        for (const id of ids) {
          checkId(id)
          written.delete(id)
          await fsp.rm(path.join(d, `${id}.png`), { force: true })
        }
      },
      async commit(skeleton, images) {
        for (const img of images) checkId(img && img.id)
        await prepare()
        for (const img of images) await writeImage(img.id, img.base64)
        await fsp.writeFile(path.join(d, 'skeleton.json'), JSON.stringify(skeleton))
        await fsp.writeFile(done(key), '')
        active.delete(name)
        await evict(name)
      },
      // 실패한 쓰기를 치운다. 원래 오류를 가리지 않게 어떤 오류도 던지지 않는다.
      async abort() {
        active.delete(name)
        if (prepared) await fsp.rm(d, RM_DIR).catch(() => {})
      }
    }
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
    await fsp.rm(dir, RM_DIR)
  }

  // 풀던 중 서버가 죽어 남은 디렉터리(.done 없음)를 지운다 — 용량 합계에 계속 들고 evict 도 지우지 않는다. 서버를 띄울 때 한 번 부른다(deps).
  // 지금 쓰는 중인 디렉터리·완료된 판·디렉터리가 아닌 것은 두고, 지운 수를 준다. 어떤 오류도 던지지 않는다(못 지운 것은 다음에).
  async function sweepUnfinished() {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return 0
    }
    let removed = 0
    for (const e of entries) {
      if (!e.isDirectory() || active.has(e.name)) continue
      const d = path.join(dir, e.name)
      if (await fsp.stat(path.join(d, '.done')).catch(() => null)) continue
      try {
        await fsp.rm(d, RM_DIR)
        removed++
      } catch {
        // 다음에 다시 본다
      }
    }
    return removed
  }

  return { readSkeleton, begin, imagePath, clear, sweepUnfinished }
}

module.exports = { createImageCache }
