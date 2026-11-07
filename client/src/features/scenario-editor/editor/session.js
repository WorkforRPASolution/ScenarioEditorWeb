// 편집 세션 — 서버가 준 작업본(skeleton.edited)을 그대로 쥔다. 브라우저에서 만들거나 기본값을 채우지 않는다.
export function beginSession(skeleton, me) {
  const edited = skeleton.edited ?? null
  const v = skeleton.version ?? {}
  const source = edited
    ? { process: skeleton.process, model: skeleton.model, name: skeleton.name, crtime: v.crtime, fileId: v.fileId }
    : null
  const readOnly = !me?.canWrite ? 'noWrite' : v.isCurrent === false ? 'oldVersion' : null
  return {
    source,
    headCrtime: skeleton.headCrtime,
    propertyRev: skeleton.propertyRev ?? null,
    readOnly,
    working: edited,
    saveBase: edited,
    seq: 0
  }
}

// 작업본에 없는 새 uid. session 은 불변으로 다룬다.
export function nextUid(session, prefix) {
  const used = new Set((session.working?.steps ?? []).map((s) => s.uid))
  let seq = session.seq
  let uid
  do { uid = `${prefix}${++seq}` } while (used.has(uid))
  return [uid, { ...session, seq }]
}

export const stepIndex = (working, uid) => working.steps.findIndex((s) => s.uid === uid)
export const stepNo = (working, uid) => stepIndex(working, uid) + 1
