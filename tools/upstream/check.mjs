// 사본과 WebManager 를 비교한다. verbatim 을 손댔으면 실패(종료 1), 원본 변화는 보고만 한다(--strict 면 실패).
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitReadRef, compare } from './lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const wm = resolve(root, '../WebManager')
const upstream = JSON.parse(readFileSync(join(root, 'UPSTREAM.json'), 'utf8'))
const ref = process.argv.find((a) => a.startsWith('--ref='))?.slice(6) || 'HEAD'
const strict = process.argv.includes('--strict')

const readRef = gitReadRef(wm, ref)
const readLocal = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p)) : null)

const r = compare(upstream, readRef, readLocal)
console.log(`기준 WebManager@${upstream.commit} ↔ 비교 대상 ${ref}`)
console.log(`손댄 verbatim 사본: ${r.localEdits.length}`); r.localEdits.forEach((p) => console.log(`  ✗ ${p}`))
console.log(`원본이 바뀐 파일: ${r.upstreamChanged.length}`); r.upstreamChanged.forEach((p) => console.log(`  ~ ${p}`))
console.log(`원본에서 사라진 파일: ${r.upstreamRemoved.length}`); r.upstreamRemoved.forEach((p) => console.log(`  - ${p}`))
if (r.localEdits.length || (strict && (r.upstreamChanged.length || r.upstreamRemoved.length))) process.exit(1)
