import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')

const OWNER = 'sew_w_test'
let repo
let webDb
const gridIds = []
const requestIds = []
beforeAll(async () => {
  require('dotenv').config({ path: join(ROOT, 'server/.env') })
  const { connectDB, webManagerConnection } = require('../../../../shared/db/connection')
  await connectDB()
  webDb = webManagerConnection.db
  const mongoose = require('mongoose')
  const { createWebRepository } = require('../../repo/webRepository')
  repo = createWebRepository(() => webDb, mongoose.mongo)
})
afterAll(async () => {
  if (repo) {
    await repo.deleteDraftImages(gridIds)
    await webDb.collection('SCENARIO_EDITOR_DRAFTS').deleteMany({ owner: OWNER })
    await webDb.collection('SCENARIO_EDITOR_DEPLOYS').deleteMany({ requestId: { $in: requestIds } })
  }
  await require('../../../../shared/db/connection').closeConnections()
})

describe('웹 전용 DB 저장소 (로컬 SE_WEB_DEV)', () => {
  it('초안을 두 번 저장하면 문서는 하나, revision 은 2', async () => {
    const base = { owner: OWNER, process: 'SEWCVD', model: 'SEWMODELA', name: 'SEW_W_DRAFT', base: null, headCrtime: 1, propertyRev: 0, target: { model: 'SEWMODELA', name: 'SEW_W_DRAFT' }, scenario: { v: 1 }, images: [] }
    const a = await repo.upsertDraft(base)
    const b = await repo.upsertDraft({ ...base, scenario: { v: 2 } })
    expect(a.revision).toBe(1)
    expect(b.revision).toBe(2)
    expect(b.draftId).toBe(a.draftId)
    expect(await webDb.collection('SCENARIO_EDITOR_DRAFTS').countDocuments({ owner: OWNER })).toBe(1)
    const got = await repo.getDraft(OWNER, a.draftId)
    expect(got.scenario).toEqual({ v: 2 })
    expect(await repo.getDraft('someone_else', a.draftId)).toBeNull()
    expect((await repo.findDraftFor(OWNER, 'SEWCVD', 'SEWMODELA', 'SEW_W_DRAFT'))._id.equals(got._id)).toBe(true)
    const list = await repo.listDrafts(OWNER, 'SEWCVD', 'SEWMODELA')
    expect(list).toHaveLength(1)
    expect(list[0].scenario).toBeUndefined()
    expect(await repo.deleteDraft(OWNER, a.draftId)).toEqual({ deleted: true, gridIds: [] })
    expect(await repo.deleteDraft(OWNER, a.draftId)).toEqual({ deleted: false, gridIds: [] })
  })

  it('그림을 넣고 읽고 지운다 — 초안을 지우면 그림 id 를 돌려준다', async () => {
    const buf = Buffer.from([1, 2, 3, 4, 5])
    const gridId = await repo.putDraftImage(buf, { owner: OWNER, tempId: 't1' })
    gridIds.push(gridId)
    expect((await repo.readDraftImage(gridId)).equals(buf)).toBe(true)
    const chunks = []
    for await (const c of repo.openDraftImage(gridId)) chunks.push(c)
    expect(Buffer.concat(chunks).equals(buf)).toBe(true)
    const d = await repo.upsertDraft({ owner: OWNER, process: 'SEWCVD', model: 'SEWMODELA', name: 'SEW_W_IMG', scenario: {}, images: [{ tempId: 't1', gridId }] })
    const del = await repo.deleteDraftFor(OWNER, 'SEWCVD', 'SEWMODELA', 'SEW_W_IMG')
    expect(del.deleted).toBe(true)
    expect(del.gridIds.map(String)).toEqual([String(gridId)])
    expect(d.draftId).toBeTruthy()
    await repo.deleteDraftImages([gridId, gridId])
    await expect(repo.readDraftImage(gridId)).rejects.toBeTruthy()
  })

  it('배포 기록을 넣고 고치고 읽는다', async () => {
    const requestId = `sew_w_test_${Date.now()}`
    requestIds.push(requestId)
    await repo.insertDeploy({ requestId, user: OWNER, target: { process: 'SEWCVD', model: 'SEWMODELA', name: 'SEW_W_DEP' }, startedAt: new Date(), result: 'pending', steps: [], finish: null, error: null })
    await repo.updateDeploy(requestId, { result: 'ok', crtime: 123, steps: ['setscenario'] })
    const got = await repo.getDeploy(requestId)
    expect(got).toMatchObject({ requestId, result: 'ok', crtime: 123, steps: ['setscenario'] })
    expect(await repo.getDeploy('nope')).toBeNull()
    await expect(repo.insertDeploy({ requestId })).rejects.toBeTruthy()
  })
})
