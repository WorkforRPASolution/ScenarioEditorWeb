'use strict'
// 초안(설계 §6.1) — 막힘이 있어도 저장한다(40 §2.0). 그림은 웹 전용 DB GridFS, 키는 (사용자, 공정, 모델, 이름).
const { seError } = require('../errors')

const bad = (message, details) => seError(400, 'BAD_REQUEST', message, details)
const notFound = () => seError(404, 'NOT_FOUND', '초안이 없습니다')

// 편집 시나리오가 가리키는 새 그림(from: 'upload') tempId 모음
function uploadRefs(edited) {
  const out = new Set()
  for (const s of edited.steps || []) {
    const im = s.images || { train: {}, base: null }
    for (const r of [...Object.values(im.train || {}), im.base]) if (r && r.from === 'upload') out.add(r.tempId)
  }
  return out
}

function createDraftService({ web, check, scopes }) {
  async function save(user, meta, images) {
    // 되돌린 판에서 시작한 초안은 옛 판 crtime 을 함께 둔다 — 다시 열어 배포해도 배포 기록에 되돌림이 남게(SEW-022). 배포 meta 와 같은 검사.
    const restoredFrom = meta.restoredFrom ?? null
    if (restoredFrom !== null && !Number.isSafeInteger(restoredFrom)) throw bad('restoredFrom 모양이 틀립니다', { path: 'restoredFrom', reason: '정수(crtime) 또는 null 이어야 합니다' })
    const p = await check.prepare(user, meta)
    const { edited } = p
    const t = meta.target
    const base = edited.source
    const model = base ? base.model : t.model
    const name = base ? base.name : t.name
    const process = t.process

    const refs = uploadRefs(edited)
    const prev = await web.findDraftFor(user.singleid, process, model, name)
    const prevByTemp = new Map(((prev && prev.images) || []).map((i) => [i.tempId, i.gridId]))
    for (const id of images.keys()) {
      if (!refs.has(id)) throw bad(`어떤 그림 참조도 가리키지 않는 파일이 있습니다: ${id}`, { path: `img:${id}`, reason: '시나리오가 이 tempId 를 쓰지 않습니다' })
    }
    for (const id of refs) {
      if (!images.has(id) && !prevByTemp.has(id)) throw bad(`그림 파일이 없습니다: ${id}`, { path: `img:${id}`, reason: '파일도 이전 초안의 그림도 없습니다' })
    }

    // 새 그림부터 넣는다 — 중간에 실패하면 넣은 것만 치우고 이전 초안은 그대로 둔다
    const stored = []
    const putIds = []
    try {
      for (const id of refs) {
        if (images.has(id)) {
          const gridId = await web.putDraftImage(images.get(id), { owner: user.singleid, tempId: id })
          putIds.push(gridId)
          stored.push({ tempId: id, gridId })
        } else stored.push({ tempId: id, gridId: prevByTemp.get(id) })
      }
      const out = await web.upsertDraft({
        owner: user.singleid, process, model, name,
        base: base ? { crtime: base.crtime, fileId: base.fileId } : null,
        headCrtime: edited.headCrtime,
        propertyRev: meta.propertyRev === undefined ? null : meta.propertyRev,
        target: { model: t.model, name: t.name },
        scenario: edited,
        restoredFrom,
        images: stored
      })
      // 새 초안이 쓰지 않는 이전 그림(없어진 것·새 파일로 바뀐 것)을 지운다. 실패해도 저장은 성공이다(고아 파일만 남는다).
      const keep = new Set(stored.map((s) => String(s.gridId)))
      const stale = [...prevByTemp.values()].filter((g) => !keep.has(String(g)))
      if (stale.length) { try { await web.deleteDraftImages(stale) } catch { /* 고아 정리는 다음 저장·지우기에서 못 한다 — 무시 */ } }
      return out
    } catch (e) {
      if (putIds.length) { try { await web.deleteDraftImages(putIds) } catch { /* 원래 오류를 우선한다 */ } }
      throw e
    }
  }

  async function list(user, process, model) {
    await scopes.assertAllowed(user, process, model)
    return web.listDrafts(user.singleid, process, model)
  }

  async function load(user, draftId) {
    const d = await web.getDraft(user.singleid, draftId)
    if (!d) throw notFound()
    return d
  }

  async function get(user, draftId) {
    const d = await load(user, draftId)
    const id = String(d._id)
    const imageUrls = {}
    for (const i of d.images || []) imageUrls[i.tempId] = `/scenario-editor/drafts/${id}/images/${encodeURIComponent(i.tempId)}`
    return { draftId: id, savedAt: d.savedAt, revision: d.revision, base: d.base, headCrtime: d.headCrtime, propertyRev: d.propertyRev, target: d.target, scenario: d.scenario, restoredFrom: d.restoredFrom ?? null, imageUrls }
  }

  async function image(user, draftId, tempId) {
    const d = await load(user, draftId)
    const i = (d.images || []).find((x) => x.tempId === tempId)
    if (!i) throw seError(404, 'NOT_FOUND', '초안 그림이 없습니다')
    return web.openDraftImage(i.gridId)
  }

  async function remove(user, draftId) {
    const r = await web.deleteDraft(user.singleid, draftId)
    if (!r.deleted) throw notFound()
    if (r.gridIds.length) { try { await web.deleteDraftImages(r.gridIds) } catch { /* 초안은 이미 지웠다 */ } }
    return { deleted: true }
  }

  return { save, list, get, image, remove }
}

module.exports = { createDraftService }
