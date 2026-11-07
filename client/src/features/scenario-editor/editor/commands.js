// 편집 명령 — 모두 입력을 바꾸지 않고, 바뀌지 않은 스텝은 같은 객체를 쓴다.
// 갈 곳은 uid 참조라 번호 대응표(분석 12 §5.2)를 따로 만들지 않는다: 순서가 바뀌면 화면 번호만 따라 바뀐다.
export const STEP_MAX = 200

const KEYS = ['onTrue', 'onFalse']
const idx = (w, uid) => w.steps.findIndex((s) => s.uid === uid)
const withSteps = (w, steps) => ({ ...w, steps })
const isStepRef = (t) => t?.kind === 'step'

export function applyStep(working, step) {
  return { working: withSteps(working, working.steps.map((s) => (s.uid === step.uid ? step : s))) }
}

export function insertStep(working, step, { beforeUid }) {
  if (working.steps.length >= STEP_MAX) return { refused: 'STEP_LIMIT' }
  const at = beforeUid == null ? -1 : idx(working, beforeUid)
  const steps = working.steps.slice()
  steps.splice(at < 0 ? steps.length : at, 0, step)
  return { working: withSteps(working, steps) }
}

// 남는 스텝 중 지울 스텝을 가리키는 참조(목업 refsTo).
function refsTo(working, targets) {
  const set = new Set(targets)
  const out = []
  for (const s of working.steps) {
    if (set.has(s.uid)) continue
    for (const key of KEYS) if (isStepRef(s.next[key]) && set.has(s.next[key].uid)) out.push({ uid: s.uid, key, to: s.next[key].uid })
  }
  return out
}

export function deleteSteps(working, uids) {
  const blocked = refsTo(working, uids)
  if (blocked.length) return { blocked }
  const set = new Set(uids)
  return { working: withSteps(working, working.steps.filter((s) => !set.has(s.uid))) }
}

// 번호 순으로 정렬한 인덱스. 없는 uid 가 있으면 null.
function sortedIdx(working, uids) {
  const ix = uids.map((u) => idx(working, u))
  if (!ix.length || ix.some((i) => i < 0)) return null
  return ix.sort((a, b) => a - b)
}

export function isContiguous(working, uids) {
  const ix = sortedIdx(working, uids)
  return !!ix && ix.every((v, i) => i === 0 || v === ix[i - 1] + 1)
}

export function moveSteps(working, uids, dir) {
  if (!isContiguous(working, uids)) return { refused: 'NOT_CONTIGUOUS' }
  const ix = sortedIdx(working, uids)
  const a = ix[0]
  const b = ix[ix.length - 1]
  if ((dir < 0 && a === 0) || (dir > 0 && b === working.steps.length - 1)) return { refused: 'AT_EDGE' }
  const steps = working.steps.slice()
  const seg = steps.splice(a, b - a + 1)
  steps.splice(a + dir, 0, ...seg)
  return { working: withSteps(working, steps) }
}

export function copySteps(working, uids, origin, cut) {
  if (!isContiguous(working, uids)) return { refused: 'NOT_CONTIGUOUS' }
  const ix = sortedIdx(working, uids)
  const steps = ix.map((i) => working.steps[i])
  const inside = new Set(steps.map((s) => s.uid))
  const outsideNo = {}
  for (const s of steps) {
    for (const key of KEYS) {
      const t = s.next[key]
      if (isStepRef(t) && !inside.has(t.uid)) {
        const n = idx(working, t.uid) + 1
        if (n > 0) outsideNo[`${s.uid}:${key}`] = n
      }
    }
  }
  return {
    origin, cut: !!cut, uids: steps.map((s) => s.uid), steps, outsideNo,
    eqpStateCount: steps.filter((s) => s.condition?.kind === 'eqpState').length
  }
}

function pastePos(working, where, anchorUid) {
  const a = anchorUid == null ? -1 : idx(working, anchorUid)
  if (a < 0 || where === 'end') return working.steps.length
  return where === 'before' ? a : a + 1
}

// 묶음 밖 갈 곳 → 미해결. 원래 번호는 복사할 때 가리키던 스텝이 있었을 때만 안다 — 모르면 value 키 없이(서버가 받는 모양).
function unresolvedOf(clip, uid, key) {
  const no = clip.outsideNo[`${uid}:${key}`]
  return no === undefined ? { kind: 'unresolved' } : { kind: 'unresolved', value: no }
}

// 묶음이 만들어진 세션을 떠날 때(다른 시나리오 열기·열기 실패). 브라우저가 만든 uid(n…·p…)는 세션마다 다시 세어 다음 세션에서
// 엉뚱한 스텝(복사본 자신까지)을 가리킬 수 있으므로, 묶음 밖 갈 곳 가운데 keepUids(묶음 판의 서버 uid — 같은 판이면 다음 세션에서도
// 같은 스텝)가 아닌 것을 미해결(원래 번호)로 바꾼다. 묶음 안 갈 곳은 붙일 때 새 uid 로 잇는다. 바꿀 것이 없으면 같은 묶음, 안 바뀐 스텝은 같은 객체.
export function detachClip(clip, keepUids) {
  const inside = new Set(clip.uids)
  let changed = false
  const steps = clip.steps.map((s) => {
    let next = null
    for (const key of KEYS) {
      const t = s.next[key]
      if (!isStepRef(t) || inside.has(t.uid) || keepUids.has(t.uid)) continue
      next = next ?? { ...s.next }
      next[key] = unresolvedOf(clip, s.uid, key)
    }
    if (!next) return s
    changed = true
    return { ...s, next }
  })
  return changed ? { ...clip, steps } : clip
}

const toOther = (ref, origin) => (ref && ref.from === 'source' ? { from: 'other', ...origin, id: ref.id } : ref)
function mapImages(images, origin) {
  const train = {}
  for (const [k, ref] of Object.entries(images.train ?? {})) train[k] = toOther(ref, origin)
  return { ...images, train, base: toOther(images.base, origin) }
}

export function pasteSteps(working, clip, { where, anchorUid }, { sameSource, makeUid }) {
  const k = clip.uids.length
  const pos = pastePos(working, where, anchorUid)
  if (clip.cut && sameSource) {
    // 같은 작업본 안 이동 — 스텝 객체·uid 그대로, 갈 곳은 uid 라 따라간다.
    if (anchorUid != null && clip.uids.includes(anchorUid)) return { refused: 'INSIDE_CUT' }
    const moving = new Set(clip.uids)
    const items = working.steps.filter((s) => moving.has(s.uid))
    const shift = working.steps.slice(0, pos).filter((s) => moving.has(s.uid)).length
    const steps = working.steps.filter((s) => !moving.has(s.uid))
    steps.splice(pos - shift, 0, ...items)
    return { working: withSteps(working, steps), pasted: items.map((s) => s.uid), unresolved: 0 }
  }
  if (working.steps.length + k > STEP_MAX) return { refused: 'STEP_LIMIT' }
  const map = new Map(clip.uids.map((u) => [u, makeUid()]))
  let unresolved = 0
  const copies = clip.steps.map((s) => {
    const next = { ...s.next }
    for (const key of KEYS) {
      const t = s.next[key]
      if (isStepRef(t) && map.has(t.uid)) next[key] = { kind: 'step', uid: map.get(t.uid) }
      else if (isStepRef(t) && !sameSource) next[key] = unresolvedOf(clip, s.uid, key)
      if (next[key].kind === 'unresolved') unresolved++
    }
    return { ...s, uid: map.get(s.uid), origin: null, next, images: sameSource ? s.images : mapImages(s.images, clip.origin) }
  })
  const steps = working.steps.slice()
  steps.splice(pos, 0, ...copies)
  return { working: withSteps(working, steps), pasted: copies.map((c) => c.uid), unresolved }
}

export function setCell(working, uid, field, value) {
  const steps = working.steps.map((s) => {
    if (s.uid !== uid) return s
    if (field === 'accept') return { ...s, condition: { ...s.condition, image: { ...s.condition.image, accept: value } } }
    if (field === 'skip') return { ...s, condition: { ...s.condition, skipPreprocessing: value } }
    return { ...s, next: { ...s.next, [field]: value } }
  })
  return { working: withSteps(working, steps) }
}

// 번호가 바뀐 참조 — "다른 스텝의 번호 N곳이 새 번호를 따라갔습니다" 알림과 칸 강조용(목업 refsNumbers 비교).
function refNumbers(w) {
  const pos = new Map(w.steps.map((s, i) => [s.uid, i + 1]))
  const m = new Map()
  for (const s of w.steps) for (const key of KEYS) if (isStepRef(s.next?.[key])) m.set(`${s.uid}:${key}`, pos.get(s.next[key].uid))
  return m
}
// 앞뒤 모두에 있는 참조 가운데 가리키는 번호가 바뀐 것의 `${uid}:${onTrue|onFalse}` 집합.
export function movedRefKeys(before, after) {
  const b = refNumbers(before)
  const out = new Set()
  for (const [k, v] of refNumbers(after)) if (b.has(k) && b.get(k) !== v) out.add(k)
  return out
}
export const movedRefs = (before, after) => movedRefKeys(before, after).size
