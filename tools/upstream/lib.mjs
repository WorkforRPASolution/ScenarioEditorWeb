import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export function sha256(data) {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex')
}

// WebManager 작업 트리에는 다른 세션의 미커밋 변경이 있다 — 커밋 객체에서만 꺼낸다.
export function gitReadRef(wmDir, ref, exec = execFileSync) {
  return (p) => {
    try {
      return exec('git', ['-C', wmDir, 'show', `${ref}:${p}`], { maxBuffer: 64 * 1024 * 1024 })
    } catch {
      return null
    }
  }
}

export function planImport(manifest, readRef, readLocal) {
  const writes = []
  const records = []
  const missing = []
  for (const f of manifest.files) {
    const src = readRef(f.path)
    if (src === null || src === undefined) {
      missing.push(f.path)
      continue
    }
    const sourceSha256 = sha256(src)
    const isCopy = f.mode === 'verbatim' || f.mode === 'test'
    if (isCopy) writes.push({ path: f.path, content: src })
    if (f.mode === 'shell-modified' && !readLocal(f.path)) writes.push({ path: f.path, content: src })
    records.push({ path: f.path, mode: f.mode, sourceSha256, localSha256: isCopy ? sourceSha256 : null, reason: f.reason ?? null })
  }
  return { writes, records, missing }
}

export function compare(upstream, readRef, readLocal) {
  const localEdits = []
  const upstreamChanged = []
  const upstreamRemoved = []
  for (const f of upstream.files) {
    const ref = readRef(f.path)
    if (ref === null || ref === undefined) upstreamRemoved.push(f.path)
    else if (sha256(ref) !== f.sourceSha256) upstreamChanged.push(f.path)
    if (f.localSha256) {
      const local = readLocal(f.path)
      if (!local || sha256(local) !== f.localSha256) localEdits.push(f.path)
    }
  }
  return { localEdits, upstreamChanged, upstreamRemoved }
}
