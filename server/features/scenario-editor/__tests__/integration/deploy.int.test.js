import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
const require = createRequire(import.meta.url)

// 배포 통합 시험(설계 §2 완료 조건 4·5·6·7, §13.2). 로컬 Mongo·Redis·InterfaceServer 와 시험 데이터(npm run seed -- reset basic anomaly)가 있어야 한다.
// 시드 시나리오(basic·anomaly)는 읽기만 한다 — P1 시험이 그 값과 대조한다. 이 시험이 만들고 바꾸는 시나리오는 이름이 SEW_W_ 로 시작하고 끝나면 지운다.
const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '../../../../..')
const { startFaultProxy } = require(join(ROOT, 'tools/infra/fault-proxy.js'))
const { EJSON } = require('bson')
const { parseField, pickCurrent } = require('../../domain/versionPick')
const { emptyPerformance } = require('../../domain/performanceEdit')
const { kstDate } = require('../../domain/owners')

const USERS = ['sew_master', 'sew_cvd', 'sew_multi', 'sew_mastercvd', 'sew_spaces', 'sew_longgrade', 'sew_none']
const STAMP = Date.now().toString(36).toUpperCase()
const NAME = (tag) => `SEW_W_${STAMP}_${tag}`
const CVD = { process: 'SEWCVD', model: 'SEWMODELA' }
const PHOTO = { process: 'SEWPHOTO', model: 'SEWMODELA' }
const SOURCE = { ...CVD, name: 'ALL_CONDITIONS' } // 기준 화면 2·찾을 그림 1, 손대지 않고 배포해도 막힘이 없다
const PHOTO_SOURCE = { ...PHOTO, name: 'ABC' }
const PROPERTY_INT32 = ['ScenarioTriggerType', 'StartDelay', 'RetryCnt', 'RetryInterval', 'Type', 'ExecutingLevel', 'Priority', 'LcncType']
const GEN = join(ROOT, 'tools/scenario-gen/out/basic/ALL_CONDITIONS')

let server
let base
let proxy
let db
let webDb
let redis
let mongo
let deps

beforeAll(async () => {
  require('dotenv').config({ path: join(ROOT, 'server/.env') })
  process.env.SE_DEV_USER_OVERRIDE = '1'
  process.env.IMAGE_CACHE_DIR = join(ROOT, 'server/.cache/int-images')
  const conn = require('../../../../shared/db/connection')
  const { connectRedis, getRedisClient } = require('../../../../shared/db/redisConnection')
  await conn.connectDB()
  await connectRedis()
  db = conn.earsConnection.db
  webDb = conn.webManagerConnection.db
  // WEBMANAGER_DB_URI 가 비면 연결 코드가 WebManager 의 실제 로그 DB 로 떨어진다 — 아무것도 쓰기 전에 멈춘다
  if (webDb.databaseName !== 'SE_WEB_DEV') throw new Error(`웹 전용 DB 가 SE_WEB_DEV 가 아니다: ${webDb.databaseName}`)
  redis = getRedisClient()
  mongo = require('mongoose').mongo
  const app = require('../../../../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
  proxy = await startFaultProxy({ target: process.env.EARS_INTERFACE_URL || 'http://localhost:8080' })
  deps = require('../../deps').getDeps()
})

// 실패해도 지운다: SEW_W_ 시나리오의 SC_PROPERTY·GridFS·Redis 필드, 시험 사용자의 초안·초안 그림·배포 기록
async function cleanup() {
  if (!db) return
  await db.collection('SC_PROPERTY').deleteMany({ process: /^SEW/, scname: /^SEW_W_/ })
  const bucket = new mongo.GridFSBucket(db)
  for (const f of await db.collection('fs.files').find({ 'metadata.process': /^SEW/, 'metadata.name': /^SEW_W_/ }, { projection: { _id: 1 } }).toArray()) await bucket.delete(f._id)
  for (const key of await redis.keys('SEW*-*')) {
    if ((await redis.type(key)) !== 'hash') continue
    const fields = (await redis.hkeys(key)).filter((f) => f.startsWith('SEW_W_'))
    if (fields.length) await redis.hdel(key, ...fields)
  }
  if (webDb && webDb.databaseName === 'SE_WEB_DEV') {
    await webDb.collection('SCENARIO_EDITOR_DRAFTS').deleteMany({ owner: { $in: USERS } })
    await webDb.collection('SCENARIO_EDITOR_DEPLOYS').deleteMany({ user: { $in: USERS } })
    const images = new mongo.GridFSBucket(webDb, { bucketName: 'seDraftImages' })
    for (const f of await webDb.collection('seDraftImages.files').find({ 'metadata.owner': { $in: USERS } }, { projection: { _id: 1 } }).toArray()) await images.delete(f._id)
  }
}

afterAll(async () => {
  try {
    await cleanup()
  } finally {
    if (proxy) await proxy.close()
    if (server) await new Promise((r) => server.close(r))
    await require('../../../../shared/db/connection').closeConnections()
    await require('../../../../shared/db/redisConnection').closeRedis()
  }
})

// ---- 요청 ----
const enc = encodeURIComponent
const H = (user) => ({ 'X-SE-User': user })
const pathOf = (k) => `/scenarios/${enc(k.process)}/${enc(k.model)}/${enc(k.name)}`
async function call(method, path, { user = 'sew_master', json, form } = {}) {
  const init = { method, headers: H(user) }
  if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json) }
  if (form) init.body = form
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}
// multipart: meta(JSON) + 그림 img:<tempId>
function formOf(meta, files = {}) {
  const f = new FormData()
  f.append('meta', JSON.stringify(meta))
  for (const [tempId, buf] of Object.entries(files)) f.append(`img:${tempId}`, new Blob([buf], { type: 'image/png' }), `${tempId}.png`)
  return f
}
const deploy = (meta, user = 'sew_master', files) => call('POST', '/deploy', { user, form: formOf(meta, files) })
const verify = (requestId, user = 'sew_master') => call('POST', `/deploy/${requestId}/verify`, { user })
const finish = (requestId, user = 'sew_master') => call('POST', `/deploy/${requestId}/finish`, { user })
const metaOf = (sk, target, extra = {}) => ({ target, propertyRev: sk.propertyRev, scenario: sk.edited, requestId: randomUUID(), ...extra })
const show = (r) => JSON.stringify(r.body)

async function openRaw(k, user = 'sew_master', crtime = 'current') {
  const r = await call('GET', `${pathOf(k)}/versions/${crtime}`, { user })
  expect(r.status, show(r)).toBe(200)
  return { sk: r.body.data, stats: r.headers.get('x-se-open-stats') }
}
const open = async (k, user, crtime) => (await openRaw(k, user, crtime)).sk

function expectOk(r) {
  expect(r.status, show(r)).toBe(200)
  expect(r.body.data.result, show(r)).toBe('ok')
  return r.body.data
}

// 시드 시나리오를 새 SEW_W_ 이름으로 복사 배포
async function copyTo(source, name, user = 'sew_master') {
  const sk = await open(source, user)
  const target = { process: source.process, model: source.model, name }
  const data = expectOk(await deploy(metaOf(sk, target), user))
  return { target, crtime: data.crtime, requestId: data.requestId, source: sk }
}

// ---- 저장 상태 읽기 ----
const keyFilter = (k) => ({ process: k.process, eqpModel: k.model, scname: k.name })
const propertyDocs = (k) => db.collection('SC_PROPERTY').find(keyFilter(k)).toArray()
async function propertyDoc(k) {
  const docs = await propertyDocs(k)
  expect(docs).toHaveLength(1)
  return docs[0]
}
const rawPerformance = async (k) => (await db.collection('SC_PROPERTY').findOne(keyFilter(k), { promoteLongs: false, projection: { _id: 0, performance: 1 } })).performance
const typeCount = (k, field, type) => db.collection('SC_PROPERTY').countDocuments({ ...keyFilter(k), [field]: { $type: type } })
const hashKey = (k) => `${k.process}-${k.model}`
const redisFields = async (k) => (await redis.hkeys(hashKey(k))).filter((f) => { const p = parseField(f); return p && p.name === k.name })
const redisValue = (k, crtime) => redis.hget(hashKey(k), `${k.name}.${crtime}`)
const currentOf = async (k) => pickCurrent(await redis.hkeys(hashKey(k)), k.name)
const fileOf = (k, crtime) => db.collection('fs.files').findOne({ 'metadata.process': k.process, 'metadata.model': k.model, 'metadata.name': k.name, 'metadata.crtime': crtime })
const filesOf = (k) => db.collection('fs.files').find({ 'metadata.process': k.process, 'metadata.model': k.model, 'metadata.name': k.name }).toArray()
async function biOf(k, crtime) {
  const file = await fileOf(k, crtime)
  expect(file, `${k.name}.${crtime} GridFS 파일`).toBeTruthy()
  const chunks = []
  for await (const c of new mongo.GridFSBucket(db).openDownloadStream(file._id)) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}
const deployRecord = (requestId) => webDb.collection('SCENARIO_EDITOR_DEPLOYS').findOne({ requestId })
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const idOf = (k) => `${k.process}-${k.model}-${k.name}`

// Owners 줄: 아이디@yyyy-MM-dd HH:mm:ss(KST). 시각은 배포 시작 이후·지금 이전.
const ownerLine = (user) => new RegExp(`^${user}@\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$`)
function expectDeployLine(line, user, startedMs) {
  expect(line).toMatch(ownerLine(user))
  const at = Date.parse(`${line.slice(user.length + 1).replace(' ', 'T')}+09:00`)
  expect(at).toBeGreaterThanOrEqual(Math.floor(startedMs / 1000) * 1000)
  expect(at).toBeLessThanOrEqual(Date.now())
}
const linesOf = (owners, user) => owners.filter((l) => ownerLine(user).test(l))

// 스텝 비교용(뼈대 화면 값). 그림 URL 은 시나리오 이름·판·파일 id 를 품어 판마다 다르다 — 참조는 edited 로 비교한다.
const noUrls = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'url' ? undefined : x)))
const stepView = (s) => ({ uid: s.uid, condition: noUrls(s.condition), action: s.action, next: s.next, retry: s.retry, descriptionToEmail: s.descriptionToEmail, baseImage: s.baseImage.state })
const withoutIdOwners = ({ ID, Owners, ...rest }) => rest

// 중계를 거쳐 부른다. InterfaceServer 클라이언트는 부를 때마다 EARS_INTERFACE_URL 을 읽는다.
async function withProxy(mode, fn) {
  const direct = process.env.EARS_INTERFACE_URL
  await proxy.setMode(mode)
  process.env.EARS_INTERFACE_URL = proxy.url
  try {
    return await fn()
  } finally {
    // 원래 없던 값이면 지운다 — 대입하면 문자열 "undefined" 가 남아 뒤 시험이 undefined/EARS/Interface 를 부른다
    if (direct === undefined) delete process.env.EARS_INTERFACE_URL
    else process.env.EARS_INTERFACE_URL = direct
    await proxy.setMode('pass')
  }
}

describe('배포 — 새 대상·덮어쓰기·왕복 (완료 조건 1·2·5)', () => {
  const COPY = { ...CVD, name: NAME('COPY') }
  let copyCrtime

  it('시드 시나리오를 새 이름으로 배포(sew_master 등급 1): GridFS·Redis·SC_PROPERTY 형식, 성과 복사, 다시 열면 같은 스텝·참조', async () => {
    const src = await open(SOURCE)
    const started = Date.now()
    const r = await deploy(metaOf(src, COPY))
    const data = expectOk(r)
    expect(data.partialFailed).toEqual([])
    expect(r.headers.get('x-se-deploy-stats')).toMatch(/^ms=\d+;peakRssMb=\d+$/)
    copyCrtime = data.crtime
    expect(Number.isSafeInteger(copyCrtime)).toBe(true)

    // Redis: 원본 판 본문에서 ID 만 바뀐 글자, 배포 기록 지문과 같다
    const srcValue = await redisValue(SOURCE, src.version.crtime)
    const value = await redisValue(COPY, copyCrtime)
    expect(srcValue).toContain(`"ID":"${idOf(SOURCE)}"`)
    expect(value).toBe(srcValue.replace(`"ID":"${idOf(SOURCE)}"`, `"ID":"${idOf(COPY)}"`))
    const record = await deployRecord(data.requestId)
    expect(record).toMatchObject({ user: 'sew_master', result: 'ok', crtime: copyCrtime, steps: ['setscenario', 'finish'], target: COPY, restoredFrom: null })
    expect(record.bodySha256).toBe(sha256(value))
    expect(record.fieldsBefore).toEqual([])

    // GridFS: 파일 이름 규칙, BI 는 원본 판 BI 에서 BI ID 만 바뀐 글자
    const file = await fileOf(COPY, copyCrtime)
    expect(file.filename).toBe(`${COPY.process}.${COPY.model}.${COPY.name}.${copyCrtime}`)
    const bi = await biOf(COPY, copyCrtime)
    expect(bi.startsWith(`{"ID":"BI.${idOf(COPY)}",`)).toBe(true)
    expect(bi).toBe((await biOf(SOURCE, src.version.crtime)).replace(`"ID":"BI.${idOf(SOURCE)}"`, `"ID":"BI.${idOf(COPY)}"`))

    // SC_PROPERTY: scCategory·trCategory Int64, property 정수 Int32, property.ID = 새 ID, Owners = 원본 문서 목록 + 배포 줄
    const doc = await propertyDoc(COPY)
    const srcDoc = await propertyDoc(SOURCE)
    const sourceOwners = srcDoc.property.Owners
    expect(await typeCount(COPY, 'scCategory', 'long')).toBe(1)
    expect(await typeCount(COPY, 'trCategory', 'long')).toBe(1)
    expect(doc.scCategory).toBe(src.edited.property.Type)
    expect(doc.trCategory).toBe(0)
    for (const k of PROPERTY_INT32) expect(await typeCount(COPY, `property.${k}`, 'int'), k).toBe(1)
    expect(doc.property.ID).toBe(idOf(COPY))
    expect(doc.property.Owners).toHaveLength(sourceOwners.length + 1)
    expect(doc.property.Owners.slice(0, -1)).toEqual(sourceOwners)
    expectDeployLine(doc.property.Owners.at(-1), 'sew_master', started)
    // 새 대상 성과(40 §2.5 (c)): 등급 1 은 원본 복사 — BSON 형까지 같다
    expect(EJSON.stringify(await rawPerformance(COPY), { relaxed: false })).toBe(EJSON.stringify(await rawPerformance(SOURCE), { relaxed: false }))

    // 다시 열기: 같은 스텝·참조(완료 조건 2 의 서버 쪽). 새 판이라 GridFS 에서 풀어 PNG 캐시에 쓴다.
    const { sk: back, stats } = await openRaw(COPY)
    expect(stats).toContain('fromCache=false')
    expect(back.version.crtime).toBe(copyCrtime)
    expect(back.headCrtime).toBe(copyCrtime)
    expect(back.steps.map(stepView)).toEqual(src.steps.map(stepView))
    expect(noUrls(back.edited.steps)).toEqual(noUrls(src.edited.steps)) // 그림 참조(from·id)·조건·동작·다음 스텝이 같다
    expect(back.edited.header).toEqual(src.edited.header)
    expect(withoutIdOwners(back.edited.property)).toEqual(withoutIdOwners(src.edited.property))
  })

  it('고치지 않고 다시 배포하면 본문(Redis)·BI 가 앞 판과 글자까지 같다 — 열기 경로(PNG 캐시 → base64)·BI ID 포함', async () => {
    const sk = await open(COPY)
    const refs = sk.edited.steps.flatMap((s) => [...Object.values(s.images.train), s.images.base]).filter((x) => x && x.from === 'source')
    expect(refs.length).toBeGreaterThanOrEqual(3) // 기준 화면 2 + 찾을 그림 1 이 PNG 에서 base64 로 다시 만들어진다
    // 캐시를 비워 배포의 기준 판 읽기(opener.resolveImage)가 GridFS 에서 다시 풀어 PNG 로 쓴 뒤 읽게 한다
    expect((await call('POST', '/cache/refresh?images=1')).status).toBe(200)
    const data = expectOk(await deploy(metaOf(sk, COPY)))
    expect(data.crtime).not.toBe(copyCrtime)
    expect(await redisValue(COPY, data.crtime)).toBe(await redisValue(COPY, copyCrtime))
    const bi = await biOf(COPY, data.crtime)
    expect(bi).toBe(await biOf(COPY, copyCrtime))
    expect(bi.startsWith(`{"ID":"BI.${idOf(COPY)}",`)).toBe(true)
    copyCrtime = data.crtime
  })

  it('한 스텝만 고쳐 덮어쓰면 새 판이고, 고치지 않은 스텝·머리·BI 는 저장값 그대로', async () => {
    const sk = await open(COPY)
    const k = 1
    const text = '덮어쓰기 시험 — 이 칸만 바뀐다'
    sk.edited.steps[k].descriptionToEmail = text
    const data = expectOk(await deploy(metaOf(sk, COPY)))
    expect(await redisFields(COPY)).toHaveLength(3)
    expect(await currentOf(COPY)).toBe(data.crtime)
    const prev = JSON.parse(await redisValue(COPY, copyCrtime))
    const now = JSON.parse(await redisValue(COPY, data.crtime))
    const { Step: prevSteps, ...prevHead } = prev
    const { Step: nowSteps, ...nowHead } = now
    expect(nowHead).toEqual(prevHead)
    expect(nowSteps).toHaveLength(prevSteps.length)
    nowSteps.forEach((s, i) => expect(s, `step ${i}`).toEqual(i === k ? { ...prevSteps[i], DescriptionToEmail: text } : prevSteps[i]))
    expect(await biOf(COPY, data.crtime)).toBe(await biOf(COPY, copyCrtime))
    copyCrtime = data.crtime
  })

  it('sew_multi(등급 3)가 새 이름으로 배포하면 성과는 빈 PerformanceItem, 이미 있는 대상은 덮어쓰기 확인이 있어야 하고 대상 성과는 그대로', async () => {
    const MULTI = { ...CVD, name: NAME('MULTI') }
    const src = await open(SOURCE, 'sew_multi')
    const started = Date.now()
    expectOk(await deploy(metaOf(src, MULTI), 'sew_multi'))
    const doc = await propertyDoc(MULTI)
    expect(doc.performance).toEqual(emptyPerformance())
    expectDeployLine(doc.property.Owners.at(-1), 'sew_multi', started)

    // 다른 시나리오(원본)를 이미 있는 MULTI 로: 확인 없으면 409 TARGET_EXISTS(바뀌는 운영 속성 차이), 확인하면 덮어쓰고 성과는 건드리지 않는다
    const master = await open(SOURCE)
    const fieldsBefore = await redisFields(MULTI)
    const refused = await deploy(metaOf(master, MULTI))
    expect(refused.status, show(refused)).toBe(409)
    expect(refused.body.code).toBe('TARGET_EXISTS')
    expect(Array.isArray(refused.body.details.diff)).toBe(true)
    expect(await redisFields(MULTI)).toEqual(fieldsBefore)
    expectOk(await deploy(metaOf(master, MULTI, { overwrite: true })))
    expect(await redisFields(MULTI)).toHaveLength(fieldsBefore.length + 1)
    const after = await propertyDoc(MULTI)
    expect(after.performance).toEqual(emptyPerformance())
    expect(after.property.Owners).toHaveLength(doc.property.Owners.length + 1)
    expect(linesOf(after.property.Owners, 'sew_master')).toHaveLength(1)
  })

  it('basic/ALL_ACTIONS 를 손대지 않고 배포하면 422 FAP_TYPE_MISMATCH(운영 속성 Type 이 7 이 아님), 아무것도 쓰지 않는다', async () => {
    const t = { ...CVD, name: NAME('FAP') }
    const meta = metaOf(await open({ ...CVD, name: 'ALL_ACTIONS' }), t)
    const r = await deploy(meta)
    expect(r.status, show(r)).toBe(422)
    expect(r.body.code).toBe('VALIDATION_FAILED')
    expect(r.body.details.blocks.map((b) => b.code)).toContain('FAP_TYPE_MISMATCH')
    expect(await propertyDocs(t)).toEqual([])
    expect(await redisFields(t)).toEqual([])
    expect(await deployRecord(meta.requestId)).toBeNull()
  })
})

describe('정규가 아닌 base64 는 저장값 그대로 (판정 R5)', () => {
  it('찾을 그림·기준 화면에 줄바꿈이 든 판을 열어 다른 스텝만 고쳐 배포하면 그 글자가 새 본문·BI 에 그대로 있다', async () => {
    const NC = { ...CVD, name: NAME('NC') }
    // 시드 적재처럼 InterfaceServer setscenario 로 한 번 쓴다. 생성기 글자(스텝 0 이미지·1 OCR·2 조건 없음·3 설비 상태)에서 ID 를 바꾸고
    // 스텝 0 의 찾을 그림과 스텝 2 의 기준 화면 자리에 줄바꿈(JSON \n)이 든 base64 를 넣는다. 스텝 2 는 기준 화면이 필요 없는 조건이다
    // (이미지 스텝의 기준 화면은 아래 시험이 본다).
    const swapId = (s, prefix = '') => s.replace(`"ID":"${prefix}${idOf(SOURCE)}"`, `"ID":"${prefix}${idOf(NC)}"`)
    let body = swapId(readFileSync(join(GEN, 'body.v1.json'), 'utf8'))
    let bi = swapId(readFileSync(join(GEN, 'bi.v1.json'), 'utf8'), 'BI.')
    const property = swapId(readFileSync(join(GEN, 'property.v1.json'), 'utf8'))
    const train = /"BinaryImage":"([A-Za-z0-9+/=]{200,})"/.exec(body)
    const trainOdd = `${train[1].slice(0, 76)}\\n${train[1].slice(76)}`
    body = body.replace(train[0], `"BinaryImage":"${trainOdd}"`)
    const snap = JSON.parse(bi).TargetSnapshotList[0]
    const snapOdd = `${snap.slice(0, 76)}\\n${snap.slice(76)}`
    expect(bi.endsWith('"AA==","AA=="]}')).toBe(true)
    bi = bi.replace('"AA==","AA=="]}', `"${snapOdd}","AA=="]}`)
    await require('../../clients/interfaceClient').setScenario({ ...NC, body, bi, property })
    const crtime = await currentOf(NC)
    expect(await redisValue(NC, crtime)).toBe(body)

    const sk = await open(NC)
    const trainStep = sk.edited.steps.findIndex((s) => Object.values(s.images.train).some((x) => 'literal' in x && typeof x.literal === 'string' && x.literal.includes('\n')))
    const snapStep = sk.edited.steps.findIndex((s) => s.images.base && typeof s.images.base.literal === 'string' && s.images.base.literal.includes('\n'))
    expect(trainStep).toBeGreaterThanOrEqual(0)
    expect(snapStep).toBeGreaterThanOrEqual(0)
    const other = sk.edited.steps.findIndex((_, i) => i !== trainStep && i !== snapStep)
    const text = 'R5 시험 — 다른 스텝만 고침'
    sk.edited.steps[other].descriptionToEmail = text
    const data = expectOk(await deploy(metaOf(sk, NC)))

    const value = await redisValue(NC, data.crtime)
    expect(value).toContain(`"BinaryImage":"${trainOdd}"`)
    const prev = JSON.parse(body)
    const now = JSON.parse(value)
    now.Step.forEach((s, i) => expect(s, `step ${i}`).toEqual(i === other ? { ...prev.Step[i], DescriptionToEmail: text } : prev.Step[i]))
    const newBi = await biOf(NC, data.crtime)
    expect(newBi).toContain(`"${snapOdd}"`)
    expect(newBi).toBe(bi)
  })

  it('이미지 스텝의 기준 화면이 줄바꿈 든 base64 여도(literal) BASE_IMAGE_MISSING 으로 막지 않고 배포한다 — BI 는 글자 그대로', async () => {
    const NC0 = { ...CVD, name: NAME('NC0') }
    const swapId = (s, prefix = '') => s.replace(`"ID":"${prefix}${idOf(SOURCE)}"`, `"ID":"${prefix}${idOf(NC0)}"`)
    const body = swapId(readFileSync(join(GEN, 'body.v1.json'), 'utf8'))
    let bi = swapId(readFileSync(join(GEN, 'bi.v1.json'), 'utf8'), 'BI.')
    const property = swapId(readFileSync(join(GEN, 'property.v1.json'), 'utf8'))
    const snap = JSON.parse(bi).TargetSnapshotList[0] // 스텝 0 = 이미지 조건
    const snapOdd = `${snap.slice(0, 76)}\\n${snap.slice(76)}`
    bi = bi.replace(`"${snap}"`, `"${snapOdd}"`)
    await require('../../clients/interfaceClient').setScenario({ ...NC0, body, bi, property })

    const sk = await open(NC0)
    expect(sk.edited.steps[0].condition.kind).toBe('image')
    expect(sk.edited.steps[0].images.base).toEqual({ literal: JSON.parse(`"${snapOdd}"`) })
    const other = sk.edited.steps.findIndex((s, i) => i > 0 && s.condition.kind === 'none')
    sk.edited.steps[other].descriptionToEmail = 'R5 기준 화면 — 다른 스텝만 고침'
    const data = expectOk(await deploy(metaOf(sk, NC0)))
    expect(await biOf(NC0, data.crtime)).toBe(bi)
  })
})

describe('고장 주입 (설계 §6.3·§13.2)', () => {
  it.each(['slow500', 'dropAfter'])('%s: InterfaceServer 는 저장했는데 504 결과 모름 → 확인하면 내 판·Owners 한 줄, 다시 확인해도 같다', async (mode) => {
    const src = await open(SOURCE)
    const t = { ...CVD, name: NAME(mode.toUpperCase()) }
    const meta = metaOf(src, t)
    const started = Date.now()
    const r = await withProxy(mode, () => deploy(meta))
    expect(r.status, show(r)).toBe(504)
    expect(r.body.code).toBe('UPSTREAM_TIMEOUT')
    expect(r.body.details).toEqual({ requestId: meta.requestId })
    expect((await deployRecord(meta.requestId)).result).toBe('unknown')
    // 판은 저장됐고 마무리(Owners 줄·scCategory)는 아직
    const fields = await redisFields(t)
    expect(fields).toHaveLength(1)
    const owners = (await propertyDoc(SOURCE)).property.Owners
    const before = await propertyDoc(t)
    expect(before.property.Owners).toEqual(owners)
    expect(before.scCategory).toBeUndefined()

    const v1 = await verify(meta.requestId)
    expect(v1.status, show(v1)).toBe(200)
    expect(v1.body.data).toEqual({ found: 'mine', crtime: parseField(fields[0]).crtime, result: 'ok', partialFailed: [] })
    const doc = await propertyDoc(t)
    expect(doc.property.Owners.slice(0, -1)).toEqual(owners)
    expect(linesOf(doc.property.Owners, 'sew_master')).toHaveLength(1)
    expectDeployLine(doc.property.Owners.at(-1), 'sew_master', started)
    expect(await typeCount(t, 'scCategory', 'long')).toBe(1)
    expect(await deployRecord(meta.requestId)).toMatchObject({ result: 'ok', crtime: v1.body.data.crtime })

    const v2 = await verify(meta.requestId)
    expect(v2.body.data).toEqual(v1.body.data)
    expect((await propertyDoc(t)).property.Owners).toEqual(doc.property.Owners)
  })

  it('hang: 받고 답하지 않으면 504, 확인 → none 이고 다시 배포할 수 있다', async () => {
    const src = await open(SOURCE)
    const t = { ...CVD, name: NAME('HANG') }
    const meta = metaOf(src, t)
    const r = await withProxy('hang', () => deploy(meta)) // setscenario 시간 제한(15초 + 1MB 마다 0.5초)까지 기다린다
    expect(r.status, show(r)).toBe(504)
    expect(r.body.code).toBe('UPSTREAM_TIMEOUT')
    expect(r.body.details).toEqual({ requestId: meta.requestId })
    expect(await redisFields(t)).toEqual([])
    expect(await propertyDocs(t)).toEqual([])
    const v = await verify(meta.requestId)
    expect(v.status, show(v)).toBe(200)
    expect(v.body.data).toEqual({ found: 'none', crtime: null })
    expectOk(await deploy(metaOf(src, t)))
    expect(await redisFields(t)).toHaveLength(1)
  })

  it('down: 연결이 거부되면 503, 판·문서 없음, 확인 → none', async () => {
    const src = await open(SOURCE)
    const t = { ...CVD, name: NAME('DOWN') }
    const meta = metaOf(src, t)
    const r = await withProxy('down', () => deploy(meta))
    expect(r.status, show(r)).toBe(503)
    expect(r.body.code).toBe('UPSTREAM_DOWN')
    expect(await redisFields(t)).toEqual([])
    expect(await propertyDocs(t)).toEqual([])
    expect(await filesOf(t)).toEqual([])
    expect(await deployRecord(meta.requestId)).toMatchObject({ result: 'failed', error: { code: 'UPSTREAM_DOWN' } })
    expect((await verify(meta.requestId)).body.data).toEqual({ found: 'none', crtime: null })
  })

  it('마무리 실패(Mongo 쓰기 한 번 던짐) → partial, finish 로 다시 쓰면 ok·Owners 줄 하나, 다시 불러도 그대로', async () => {
    const src = await open(SOURCE)
    const t = { ...CVD, name: NAME('FIN') }
    const meta = metaOf(src, t)
    const repo = deps.repo
    const original = repo.finishDeploy
    let thrown = 0
    repo.finishDeploy = async () => { repo.finishDeploy = original; thrown++; throw new Error('마무리 실패 주입') }
    const started = Date.now()
    let r
    try { r = await deploy(meta) } finally { repo.finishDeploy = original }
    expect(thrown).toBe(1)
    expect(r.status, show(r)).toBe(200)
    expect(r.body.data).toMatchObject({ result: 'partial', partialFailed: ['finish'], requestId: meta.requestId })
    const crtime = r.body.data.crtime
    expect(crtime).toBe(await currentOf(t))
    const owners = (await propertyDoc(SOURCE)).property.Owners
    const before = await propertyDoc(t)
    expect(before.property.Owners).toEqual(owners)
    expect(before.scCategory).toBeUndefined()
    expect(await deployRecord(meta.requestId)).toMatchObject({ result: 'partial', steps: ['setscenario'] })

    const f1 = await finish(meta.requestId)
    expect(f1.status, show(f1)).toBe(200)
    expect(f1.body.data).toEqual({ result: 'ok', crtime, partialFailed: [] })
    const doc = await propertyDoc(t)
    expect(doc.property.Owners.slice(0, -1)).toEqual(owners)
    expect(linesOf(doc.property.Owners, 'sew_master')).toHaveLength(1)
    expectDeployLine(doc.property.Owners.at(-1), 'sew_master', started)
    expect(await typeCount(t, 'scCategory', 'long')).toBe(1)
    expect(EJSON.stringify(await rawPerformance(t), { relaxed: false })).toBe(EJSON.stringify(await rawPerformance(SOURCE), { relaxed: false }))

    const f2 = await finish(meta.requestId)
    expect(f2.body.data).toEqual({ result: 'ok', crtime, partialFailed: [] })
    expect((await propertyDoc(t)).property.Owners).toEqual(doc.property.Owners)
    expect((await verify(meta.requestId)).body.data).toEqual({ found: 'mine', crtime, result: 'ok', partialFailed: [] })
  })
})

describe('충돌 (설계 §6.5)', () => {
  let CF

  it('연 뒤 다른 사용자가 새 판을 배포하면 409 SAVE_CONFLICT newVersion(by = 그 사용자), force 로 배포하면 성공', async () => {
    CF = (await copyTo(SOURCE, NAME('CONFLICT'))).target
    const mine = await open(CF)
    const other = await open(CF, 'sew_multi')
    other.edited.steps[0].descriptionToEmail = '다른 사용자가 고침'
    expectOk(await deploy(metaOf(other, CF), 'sew_multi'))
    const fields = await redisFields(CF)
    const r = await deploy(metaOf(mine, CF))
    expect(r.status, show(r)).toBe(409)
    expect(r.body.code).toBe('SAVE_CONFLICT')
    expect(r.body.details.conflict).toMatchObject({ kind: 'newVersion', by: 'sew_multi' })
    expect(r.body.details.conflict.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(await redisFields(CF)).toEqual(fields)
    expectOk(await deploy(metaOf(mine, CF, { force: true })))
    expect(await redisFields(CF)).toHaveLength(fields.length + 1)
  })

  it('켜기·끄기 뒤에는 409 property, force 로 배포하면 작업본 값으로 바뀐다', async () => {
    const mine = await open(CF)
    expect(mine.edited.property.IsEnabled).toBe(true)
    const t = await call('PUT', `${pathOf(CF)}/enabled`, { user: 'sew_multi', json: { enabled: false } })
    expect(t.status, show(t)).toBe(200)
    expect(t.body.data.isEnabled).toBe(false)
    const toggled = await propertyDoc(CF)
    expect(toggled.property.IsEnabled).toBe(false)
    expect(toggled.property.Owners.at(-1)).toMatch(/^sew_multi@\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}@Scenario Deactivated$/)
    const r = await deploy(metaOf(mine, CF))
    expect(r.status, show(r)).toBe(409)
    expect(r.body.code).toBe('SAVE_CONFLICT')
    expect(r.body.details.conflict).toEqual({ kind: 'property' })
    expectOk(await deploy(metaOf(mine, CF, { force: true })))
    expect((await propertyDoc(CF)).property.IsEnabled).toBe(true)
  })

  it('삭제 뒤: /check 는 deleted 를 알리고, delscenario 가 기준 판 파일까지 지워 배포는 force 로도 422 SOURCE_GONE', async () => {
    const mine = await open(CF)
    const del = await call('DELETE', pathOf(CF), { json: { confirmName: CF.name } })
    expect(del.status, show(del)).toBe(200)
    expect(del.body.data).toEqual({ deleted: true })
    expect(await propertyDocs(CF)).toEqual([])
    expect(await filesOf(CF)).toEqual([])
    expect((await redisFields(CF)).length).toBeGreaterThan(0) // Redis 판이 남는 것은 사내와 같다(03 §5.1 #7)
    const c = await call('POST', '/check', { json: { target: CF, propertyRev: mine.propertyRev, scenario: mine.edited } })
    expect(c.status, show(c)).toBe(200)
    expect(c.body.data.conflict).toEqual({ kind: 'deleted' })
    expect(c.body.data.blocks.map((b) => b.code)).toContain('SOURCE_GONE')
    const r = await deploy(metaOf(mine, CF, { force: true }))
    expect(r.status, show(r)).toBe(422)
    expect(r.body.details.blocks.map((b) => b.code)).toContain('SOURCE_GONE') // 기준 판이 없어 모든 스텝이 새 스텝으로 검사된다
    expect(await propertyDocs(CF)).toEqual([])
  })

  it('운영 속성 문서만 사라진 판(delscenario 가 첫 단계 뒤 멈춘 상태)은 409 deleted, force 로 다시 만들고 성과는 돌아오지 않는다', async () => {
    const D = (await copyTo(SOURCE, NAME('DELETED'))).target
    const mine = await open(D)
    // 시험 준비: delscenario 는 SC_PROPERTY 를 먼저 지우고 GridFS 파일을 지운다(InterfaceServer ScenarioWorker.scala) — 그 사이에서 멈춘 상태
    await db.collection('SC_PROPERTY').deleteMany(keyFilter(D))
    const r = await deploy(metaOf(mine, D))
    expect(r.status, show(r)).toBe(409)
    expect(r.body.code).toBe('SAVE_CONFLICT')
    expect(r.body.details.conflict).toEqual({ kind: 'deleted' })
    const started = Date.now()
    expectOk(await deploy(metaOf(mine, D, { force: true })))
    const doc = await propertyDoc(D)
    expect(doc.performance).toEqual(emptyPerformance())
    expect(doc.property.Owners).toHaveLength(1)
    expectDeployLine(doc.property.Owners[0], 'sew_master', started)
  })
})

describe('권한: 사용자 7명 × 쓰기 API (완료 조건 7)', () => {
  const PERM = { ...PHOTO, name: NAME('PERM') }
  const W = 'WRITE_FORBIDDEN'
  const P = 'PROCESS_FORBIDDEN'
  const G = 'GRADE_FORBIDDEN'
  const U = 'USER_NOT_REGISTERED'
  // 시드 users.js: sew_cvd 는 WRITE 없음·등급 0, sew_multi 는 CVD·ETCH·등급 3, sew_mastercvd 는 'MASTER;SEWCVD' = CVD 만·등급 2,
  // sew_spaces 는 'SEWCVD; SEWETCH' = CVD 만·등급 0, sew_none 은 등록 안 됨. 대상은 SEWPHOTO 라 sew_master·sew_longgrade(PHOTO·등급 Int64 2)만 통과한다.
  const DENIED = {
    sew_cvd: { check: W, drafts: W, deploy: W, enabled: W, remove: W, review: G, performance: G },
    sew_multi: { check: P, drafts: P, deploy: P, enabled: P, remove: P, review: G, performance: G },
    sew_mastercvd: { check: P, drafts: P, deploy: P, enabled: P, remove: P, review: P, performance: P },
    sew_spaces: { check: P, drafts: P, deploy: P, enabled: P, remove: P, review: G, performance: G },
    sew_none: { check: U, drafts: U, deploy: U, enabled: U, remove: U, review: U, performance: U }
  }
  const ALLOWED = ['sew_master', 'sew_longgrade']
  let sk
  // 통과하면 실제로 쓰는 요청들(거절된 사용자에게도 같은 요청을 보낸다)
  const api = {
    check: (user) => call('POST', '/check', { user, json: { target: PERM, propertyRev: sk.propertyRev, scenario: sk.edited } }),
    drafts: (user) => call('POST', '/drafts', { user, form: formOf({ target: PERM, propertyRev: sk.propertyRev, scenario: sk.edited }) }),
    deploy: (user) => deploy(metaOf(sk, PERM, { overwrite: true, force: true }), user),
    enabled: (user) => call('PUT', `${pathOf(PERM)}/enabled`, { user, json: { enabled: false } }),
    remove: (user) => call('DELETE', pathOf(PERM), { user, json: { confirmName: PERM.name } }),
    review: (user) => call('PUT', `${pathOf(PERM)}/review`, { user, json: { grade: 3, comment: `권한 시험 심의 의견 ${user}` } }),
    performance: (user) => call('PUT', `${pathOf(PERM)}/performance`, { user, json: { fields: { SupervisorComment: `권한 시험 성과 의견 ${user}`, ManWorkLoss: 10 } } })
  }

  // 대상의 운영 속성 문서·GridFS 판·Redis 필드와 SEW 전체 개수, 웹 전용 DB 전체 개수
  async function snapshot() {
    const fields = {}
    for (const f of await redisFields(PERM)) fields[f] = await redis.hget(hashKey(PERM), f)
    return EJSON.stringify({
      docs: await db.collection('SC_PROPERTY').find(keyFilter(PERM), { promoteLongs: false }).toArray(),
      files: await db.collection('fs.files').find({ 'metadata.process': PERM.process, 'metadata.model': PERM.model, 'metadata.name': PERM.name }, { projection: { length: 1, uploadDate: 1 } }).toArray(),
      fields,
      sewProperty: await db.collection('SC_PROPERTY').countDocuments({ process: /^SEW/ }),
      sewFiles: await db.collection('fs.files').countDocuments({ 'metadata.process': /^SEW/ }),
      web: {
        drafts: await webDb.collection('SCENARIO_EDITOR_DRAFTS').countDocuments(),
        deploys: await webDb.collection('SCENARIO_EDITOR_DEPLOYS').countDocuments(),
        images: await webDb.collection('seDraftImages.files').countDocuments()
      }
    }, { relaxed: false })
  }

  it('거절되는 35칸은 403 과 기대 code 이고, 그 뒤 SC_PROPERTY·GridFS·Redis·웹 전용 DB 가 그대로다', async () => {
    await copyTo(PHOTO_SOURCE, PERM.name)
    sk = await open(PERM)
    const before = await snapshot()
    const got = {}
    for (const user of Object.keys(DENIED)) {
      got[user] = {}
      for (const [name, fn] of Object.entries(api)) {
        const r = await fn(user)
        got[user][name] = r.status === 403 ? r.body.code : `${r.status} ${show(r)}`
      }
    }
    expect(got).toEqual(DENIED)
    expect(await snapshot()).toBe(before)
  })

  it('sew_master·sew_longgrade(등급 Int64 2)는 7개 API 를 모두 통과한다', async () => {
    for (const user of ALLOWED) {
      const c = await api.check(user)
      expect(c.status, `${user} check ${show(c)}`).toBe(200)
      expect(c.body.data.blocks).toEqual([])
      const d = await api.drafts(user)
      expect(d.status, `${user} drafts ${show(d)}`).toBe(200)
      expect(d.body.data.revision).toBe(1)
      expectOk(await api.deploy(user))
      const e = await api.enabled(user)
      expect(e.status, `${user} enabled ${show(e)}`).toBe(200)
      expect(e.body.data.isEnabled).toBe(false)
      const rv = await api.review(user)
      expect(rv.status, `${user} review ${show(rv)}`).toBe(200)
      expect(rv.body.data.performance).toMatchObject({ grade: 3, supervisor: user })
      const pf = await api.performance(user)
      expect(pf.status, `${user} performance ${show(pf)}`).toBe(200)
      expect(pf.body.data.performance).toMatchObject({ manWorkLoss: 10, supervisorComment: `권한 시험 성과 의견 ${user}`, supervisor: user })
      const rm = await api.remove(user)
      expect(rm.status, `${user} remove ${show(rm)}`).toBe(200)
      expect(await propertyDocs(PERM)).toEqual([])
      if (user !== ALLOWED.at(-1)) { // 다음 사용자를 위해 다시 만든다
        await copyTo(PHOTO_SOURCE, PERM.name)
        sk = await open(PERM)
      }
    }
  })
})

describe('초안 (설계 §6.1)', () => {
  it('저장·목록·열기·그림·지우기, 다시 저장한 초안의 그림으로 배포하면 초안이 사라진다', async () => {
    const DR = (await copyTo(SOURCE, NAME('DRAFT'))).target
    const sk = await open(DR)
    const idx = sk.edited.steps.findIndex((s) => s.images.base && s.images.base.from === 'source')
    sk.edited.steps[idx].images.base = { from: 'upload', tempId: 't1' }
    sk.edited.steps[idx].descriptionToEmail = '초안 시험'
    const png = readFileSync(join(ROOT, 'tools/scenario-gen/fixtures/start.png'))
    const meta = { target: DR, propertyRev: sk.propertyRev, scenario: sk.edited }

    const s1 = await call('POST', '/drafts', { form: formOf(meta, { t1: png }) })
    expect(s1.status, show(s1)).toBe(200)
    expect(s1.body.data.revision).toBe(1)
    const draftId = s1.body.data.draftId
    const list = await call('GET', `/drafts?process=${DR.process}&model=${DR.model}`)
    expect(list.body.data.find((d) => d.draftId === draftId)).toMatchObject({ name: DR.name, target: { model: DR.model, name: DR.name } })
    const got = await call('GET', `/drafts/${draftId}`)
    expect(got.status, show(got)).toBe(200)
    expect(got.body.data.scenario).toEqual(sk.edited)
    expect(got.body.data.headCrtime).toBe(sk.headCrtime)
    expect(got.body.data.propertyRev).toBe(sk.propertyRev)
    expect(got.body.data.imageUrls).toEqual({ t1: `/scenario-editor/drafts/${draftId}/images/t1` })
    const img = await fetch(`${base.replace('/scenario-editor', '')}${got.body.data.imageUrls.t1}`, { headers: H('sew_master') })
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await img.arrayBuffer()).equals(png)).toBe(true)
    const del = await call('DELETE', `/drafts/${draftId}`)
    expect(del.status, show(del)).toBe(200)
    expect(del.body.data).toEqual({ deleted: true })
    expect((await call('GET', `/drafts/${draftId}`)).status).toBe(404)

    const s2 = await call('POST', '/drafts', { form: formOf(meta, { t1: png }) })
    expect(s2.status, show(s2)).toBe(200)
    const gridId = (await webDb.collection('SCENARIO_EDITOR_DRAFTS').findOne({ _id: new mongo.ObjectId(s2.body.data.draftId) })).images[0].gridId
    const data = expectOk(await deploy({ ...meta, requestId: randomUUID() })) // 그림 파일 없이 — 초안의 그림을 쓴다
    const listAfter = await call('GET', `/drafts?process=${DR.process}&model=${DR.model}`)
    expect(listAfter.body.data.filter((d) => d.name === DR.name)).toEqual([])
    expect(await webDb.collection('seDraftImages.files').findOne({ _id: gridId })).toBeNull()
    const prevBi = JSON.parse(await biOf(DR, sk.version.crtime)).TargetSnapshotList
    const nowBi = JSON.parse(await biOf(DR, data.crtime)).TargetSnapshotList
    nowBi.forEach((v, i) => expect(v, `BI ${i}`).toBe(i === idx ? png.toString('base64') : prevBi[i]))
  })
})

describe('성과·심의 (설계 §7, 완료 조건 5)', () => {
  it('성과를 저장하고 다시 읽으면 같은 값, 원개발자(Int64)·EqpPerfornmanceLoss 는 그대로, 심의 저장은 Supervisor 를 쓴다', async () => {
    const PF = (await copyTo(SOURCE, NAME('PERF'))).target
    // 시험 준비: 사내 데스크톱이 남긴 값처럼 원개발자(Contribution Int64)와 EqpPerfornmanceLoss 를 둔다(웹은 이 둘을 성과 입력으로 쓰지 않는다)
    const developer = { KnoxId: 'sew_cvd', Sdwt: 'SEWCVD', Name: 'SEW CVD', Contribution: mongo.Long.fromNumber(60) }
    await db.collection('SC_PROPERTY').updateOne(keyFilter(PF), { $set: { 'performance.EqpPerfornmanceLoss': 42, 'performance.CitizenDeveloper': [developer] } })
    const fields = { Trigger: 4, Grade: 3, SupervisorComment: '성과 저장 시험 의견', ManWorkLoss: 120, WaferLoss: 3, ScenarioDescription: '성과 저장 시험' }
    const r = await call('PUT', `${pathOf(PF)}/performance`, { json: { fields } })
    expect(r.status, show(r)).toBe(200)
    expect(r.body.data.applied).toEqual([])
    const p = r.body.data.performance
    expect(p).toMatchObject({ trigger: 4, grade: 3, supervisorComment: fields.SupervisorComment, manWorkLoss: 120, waferLoss: 3, scenarioDescription: fields.ScenarioDescription,
      supervisor: 'sew_master', eqpPerformanceLoss: 42, updateDate: kstDate(new Date()) })
    expect(p.citizenDevelopers).toEqual([{ knoxId: 'sew_cvd', sdwt: 'SEWCVD', name: 'SEW CVD', contribution: 60 }])
    expect((await open(PF)).performance).toEqual(p)
    expect(await typeCount(PF, 'performance.CitizenDeveloper.0.Contribution', 'long')).toBe(1)
    expect(await typeCount(PF, 'performance.ManWorkLoss', 'int')).toBe(1)
    expect((await rawPerformance(PF)).EqpPerfornmanceLoss).toBe(42)

    // 심의 저장: 등급 2(sew_mastercvd, CVD 범위)가 등급·의견을 바꾸면 Supervisor 가 그 사람이다
    const rv = await call('PUT', `${pathOf(PF)}/review`, { user: 'sew_mastercvd', json: { grade: 2, comment: '심의 저장 시험 의견' } })
    expect(rv.status, show(rv)).toBe(200)
    expect(rv.body.data.performance).toMatchObject({ grade: 2, supervisorComment: '심의 저장 시험 의견', supervisor: 'sew_mastercvd', eqpPerformanceLoss: 42, manWorkLoss: 120, updateDate: p.updateDate })
    expect(rv.body.data.performance.citizenDevelopers).toEqual(p.citizenDevelopers)
    expect((await open(PF, 'sew_mastercvd')).performance).toEqual(rv.body.data.performance)
    expect(await typeCount(PF, 'performance.CitizenDeveloper.0.Contribution', 'long')).toBe(1)
  })
})
