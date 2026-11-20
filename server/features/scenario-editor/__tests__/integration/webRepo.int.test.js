import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
const { assertLocalTargets } = require(join(ROOT, 'tools/infra/sew-w-cleanup.js'))

const OWNER = 'sew_w_test'
let repo
let webDb
const gridIds = []
const requestIds = []
beforeAll(async () => {
  require('dotenv').config({ path: join(ROOT, 'server/.env') })
  // 사내 프로필 .env 로 돌리지 않는다 — 연결하기 전에 EARS·웹 DB·Redis·InterfaceServer 가 루프백인지 본다(SEW-024)
  assertLocalTargets(process.env)
  const { connectDB, webManagerConnection } = require('../../../../shared/db/connection')
  await connectDB()
  webDb = webManagerConnection.db
  // WEBMANAGER_DB_URI 가 비면 연결 코드가 WebManager 의 실제 로그 DB 로 떨어진다 — 아무것도 쓰기 전에 멈춘다(afterAll 도 repo 가 없어 지우지 않는다)
  if (webDb.databaseName !== 'SE_WEB_DEV') throw new Error(`웹 전용 DB 가 SE_WEB_DEV 가 아니다: ${webDb.databaseName}`)
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

  it('배포 기록의 Int64(finish.performance 의 Contribution)는 Long 그대로 읽는다 — 확인·다시 쓰기가 그 값을 운영 문서에 쓴다', async () => {
    const { Long } = require('mongoose').mongo
    const requestId = `sew_w_test_long_${Date.now()}`
    requestIds.push(requestId)
    const performance = { Grade: 2, CitizenDeveloper: [{ KnoxId: 'k', Sdwt: 'S', Name: 'N', Contribution: Long.fromNumber(40) }] }
    await repo.insertDeploy({ requestId, user: OWNER, target: { process: 'SEWCVD', model: 'SEWMODELA', name: 'SEW_W_DEP' }, startedAt: new Date(), result: 'unknown', crtime: null, steps: [], finish: { owners: ['a@2026-11-07 10:00:00'], scCategory: 1, performance }, error: null })
    await repo.updateDeploy(requestId, { crtime: 1730000000000 })
    const got = await repo.getDeploy(requestId)
    const c = got.finish.performance.CitizenDeveloper[0].Contribution
    expect(Long.isLong(c)).toBe(true)
    expect(c.toNumber()).toBe(40)
    expect(got.finish.performance.Grade).toBe(2) // Int32 는 숫자
    expect(got.finish.scCategory).toBe(1)
    expect(got.crtime).toBe(1730000000000) // Double 은 숫자
    expect(got.startedAt).toBeInstanceOf(Date)
  })
})
