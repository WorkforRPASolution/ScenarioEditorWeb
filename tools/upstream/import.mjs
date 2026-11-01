// WebManager 커밋 객체에서 사본을 꺼낸다. 작업 트리는 읽지 않는다(다른 세션의 미커밋 변경이 있다).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitReadRef, planImport } from './lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const wm = resolve(root, '../WebManager')
const manifest = JSON.parse(readFileSync(join(root, 'tools/upstream/manifest.json'), 'utf8'))
const commit = process.argv[2] || manifest.commit

const readRef = gitReadRef(wm, commit)
const readLocal = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p)) : null)

const { writes, records, missing } = planImport({ ...manifest, commit }, readRef, readLocal)
if (missing.length) {
  console.error(`원본에 없는 경로 ${missing.length}개:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
for (const w of writes) {
  mkdirSync(dirname(join(root, w.path)), { recursive: true })
  writeFileSync(join(root, w.path), w.content)
}
writeFileSync(join(root, 'UPSTREAM.json'), JSON.stringify({ source: 'WebManager', commit, importedAt: new Date().toISOString().slice(0, 10), files: records }, null, 2) + '\n')
console.log(`가져옴 ${writes.length}개, 기록 ${records.length}개 (WebManager@${commit})`)
