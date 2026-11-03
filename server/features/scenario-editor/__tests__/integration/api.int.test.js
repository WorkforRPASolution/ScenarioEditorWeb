import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '../../../../..')
const OUT = join(ROOT, 'tools/scenario-gen/out')
const expectedScopes = require(join(ROOT, 'tools/seed/data/expected-scopes.js'))

let server
let base
beforeAll(async () => {
  require('dotenv').config({ path: join(ROOT, 'server/.env') })
  process.env.SE_DEV_USER_OVERRIDE = '1'
  process.env.IMAGE_CACHE_DIR = join(ROOT, 'server/.cache/int-images')
  const { connectDB } = require('../../../../shared/db/connection')
  const { connectRedis } = require('../../../../shared/db/redisConnection')
  await connectDB()
  await connectRedis()
  const app = require('../../../../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
  await fetch(`${base}/cache/refresh?images=1`, { method: 'POST', headers: { 'X-SE-User': 'sew_master' } })
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  await require('../../../../shared/db/connection').closeConnections()
  await require('../../../../shared/db/redisConnection').closeRedis()
})

const get = (path, user = 'sew_master') => fetch(`${base}${path}`, { headers: { 'X-SE-User': user } })
const label = (t) => (t.kind === 'end' ? t.value : t.kind === 'next' ? 'NEXT' : t.kind === 'step' ? `→${t.no}` : `?${t.value}`)
const enc = encodeURIComponent

const scenarios = ['basic', 'anomaly'].flatMap((set) => (existsSync(join(OUT, set)) ? readdirSync(join(OUT, set)) : []).map((name) => {
  const dir = join(OUT, set, name)
  return { set, name, meta: JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')), exp: JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) }
}))

describe('공정 권한 (완료 조건 2)', () => {
  it.each(Object.entries(expectedScopes))('%s', async (user, exp) => {
    const res = await get('/scopes', user)
    expect(res.status).toBe(exp.status)
    if (exp.status === 200) expect((await res.json()).data).toEqual({ processes: exp.processes, excludedEqpCount: exp.excludedEqpCount })
  })
  it('권한 밖 공정을 직접 부르면 403', async () => {
    const res = await get('/scenarios?process=SEWETCH&model=SEWMODELA', 'sew_cvd')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PROCESS_FORBIDDEN')
  })
  it('권한 밖 쌍의 버전 목록·열기·이미지도 403 PROCESS_FORBIDDEN(있는 시나리오)', async () => {
    const path = '/scenarios/SEWETCH/SEWMODELA/EQP_STATE'
    const vs = await get(`${path}/versions`) // sew_master 는 볼 수 있다 — 시나리오와 버전이 실제로 있다
    expect(vs.status).toBe(200)
    const crtime = (await vs.json()).data[0].crtime
    // 이미지는 <img> 처럼 헤더 없이 ?seUser= 로 부른다(설정 사용자 sew_multi 는 SEWETCH 를 볼 수 있어 쿼리가 무시되면 403 이 아니다)
    const image = `${base}${path}/versions/${crtime}/files/any/images/s0-bi?seUser=sew_cvd`
    for (const res of [await get(`${path}/versions`, 'sew_cvd'), await get(`${path}/versions/current`, 'sew_cvd'), await get(`${path}/versions/${crtime}`, 'sew_cvd'), await fetch(image)]) {
      expect(res.status, res.url).toBe(403)
      expect((await res.json()).code, res.url).toBe('PROCESS_FORBIDDEN')
    }
  })
})

describe('전 종류 열기 (완료 조건 1·3)', () => {
  it('생성 시나리오가 있다', () => expect(scenarios.length).toBe(22))
  it.each(scenarios.map((s) => [`${s.set}/${s.name}`, s]))('%s', async (_, { meta, exp }) => {
    const rows = (await (await get(`/scenarios?process=${meta.process}&model=${meta.model}`)).json()).data
    const row = rows.find((r) => r.name === meta.name)
    expect(Boolean(row)).toBe(exp.list.visible)
    if (row) {
      expect(row.status.sort()).toEqual([...exp.list.status].sort())
      if (exp.list.isEnabled !== undefined) expect(row.isEnabled).toBe(exp.list.isEnabled)
    }
    // 열 수 없는 시나리오(NO_REDIS_FIELD 등)도 버전 목록은 나온다 — 조기 return 앞에서 대조한다.
    if (exp.versions) {
      const vs = (await (await get(`/scenarios/${enc(meta.process)}/${enc(meta.model)}/${enc(meta.name)}/versions`)).json()).data
      expect(vs).toHaveLength(exp.versions)
    }
    const res = await get(`/scenarios/${enc(meta.process)}/${enc(meta.model)}/${enc(meta.name)}/versions/current`)
    if (!exp.open.ok) {
      expect(res.status).toBe(exp.open.status)
      expect((await res.json()).code).toBe(exp.open.code)
      return
    }
    expect(res.status).toBe(200)
    const sk = (await res.json()).data
    if (exp.header) expect(sk.header.targetWindow).toMatchObject(exp.header.targetWindow)
    if (exp.scenarioNotes) expect(sk.notes.map((n) => n.code).sort()).toEqual([...exp.scenarioNotes].sort())
    if (exp.performance) expect(sk.performance).toMatchObject(exp.performance)
    if (exp.steps) {
      expect(sk.steps.map((s) => ({ kind: s.condition.kind, action: s.action.typeName, onTrue: label(s.next.onTrue), onFalse: label(s.next.onFalse),
        baseImage: s.baseImage.state, notes: s.notes.map((n) => n.code).sort() })))
        .toEqual(exp.steps.map((e) => ({ ...e, notes: [...e.notes].sort() })))
    }
    const img = sk.steps.find((s) => s.baseImage.state === 'present')
    if (img) {
      const r = await fetch(`${base.replace('/scenario-editor', '')}${img.baseImage.url}?seUser=sew_master`)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toBe('image/png')
      expect(Buffer.from(await r.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG')
    }
  })
  it('ABC 를 열면 ABC_2 가 아니라 ABC(1 스텝)', async () => {
    const sk = (await (await get('/scenarios/SEWPHOTO/SEWMODELA/ABC/versions/current')).json()).data
    expect(sk.steps).toHaveLength(1)
  })
})

describe('데이터 점검', () => {
  it('SEWCVD 범위의 무효·중복이 보인다', async () => {
    const d = (await (await get('/data-check', 'sew_cvd')).json()).data
    expect(d.duplicateUsers).toEqual([])
    expect(d.duplicateEqpIds).toEqual(['SEWT_DUP01'])
    expect(d.invalidEquipment.map((x) => [x.eqpId, x.reason]).sort()).toEqual([['SEWT_BADMAIL', 'WRONG_EMAIL_CATEGORY'], ['SEWT_BADREQ', 'REQUIRED_EMPTY']])
    expect(d.proxyIpDuplicates).toEqual([{ eqpId: 'SEWT_PRX02', sameAs: 'SEWT_PRX01' }])
    expect(d.duplicateProperties).toEqual([{ process: 'SEWCVD', model: 'SEWMODELB', name: 'DUP_PROPERTY', count: 2 }])
  })
})

describe('InterfaceServer 응답 해석 (실제 서버)', () => {
  it('Property 가 JSON 이 아니면 저장 없이 502 UPSTREAM_FAILED, 원문은 upstream 으로만 남는다', async () => {
    const { setScenario } = require('../../clients/interfaceClient')
    const e = await setScenario({ process: 'SEWCVD', model: 'SEWMODELA', name: 'SEW_NEVER_SAVED', body: '{}', bi: '{}', property: 'not json' }).catch((x) => x)
    expect(e).toMatchObject({ statusCode: 502, code: 'UPSTREAM_FAILED' })
    expect(e.upstream.status).toBe(200)
    expect(e.upstream.text).toContain('"success":"false"')
  })
})

describe('같은 crtime 으로 다시 올라온 파일 (캐시 정체성 = fs.files._id)', () => {
  const { meta } = scenarios.find((s) => s.name === 'ALL_ACTIONS')
  const PATH = `/scenarios/${enc(meta.process)}/${enc(meta.model)}/${enc(meta.name)}`
  const open = async (crtime = 'current') => {
    const res = await get(`${PATH}/versions/${crtime}`)
    return { status: res.status, stats: res.headers.get('x-se-open-stats'), sk: res.status === 200 ? (await res.json()).data : null }
  }
  const bucket = () => {
    const mongoose = require('mongoose')
    const { earsConnection } = require('../../../../shared/db/connection')
    return new mongoose.mongo.GridFSBucket(earsConnection.db)
  }
  const fileDoc = async (crtime) => {
    const { earsConnection } = require('../../../../shared/db/connection')
    return earsConnection.db.collection('fs.files').findOne({ 'metadata.process': meta.process, 'metadata.model': meta.model, 'metadata.name': meta.name, 'metadata.crtime': crtime })
  }
  const upload = (filename, metadata, content) => new Promise((resolve, reject) => {
    const up = bucket().openUploadStream(filename, { metadata })
    up.on('finish', () => resolve(up.id)).on('error', reject)
    up.end(content)
  })

  it('빈 BI 로 다시 올라오면(redis_to_mongo) 사내 getscenario 처럼 새 파일을 읽고, 지우면 옛 캐시로 돌아간다', async () => {
    const before = await open()
    const { crtime } = before.sk.version
    expect(before.sk.baseImageSummary.present).toBeGreaterThan(0)
    const oldUrl = before.sk.steps.find((s) => s.baseImage.state === 'present').baseImage.url
    const old = await fileDoc(crtime)
    expect(oldUrl).toContain(`/files/${old._id}/images/`)
    const id = await upload(old.filename, old.metadata, '')
    try {
      const after = await open()
      expect(after.stats).toContain('fromCache=false')
      expect(after.sk.baseImageSummary.present).toBe(0)
      // 옛 URL 은 1년 캐시 대상이라 내용이 그대로여야 한다
      expect((await fetch(`${base.replace('/scenario-editor', '')}${oldUrl}?seUser=sew_master`)).status).toBe(200)
    } finally {
      await bucket().delete(id)
    }
    const back = await open()
    expect(back.stats).toContain('fromCache=true')
    expect(back.sk.baseImageSummary.present).toBe(before.sk.baseImageSummary.present)
  })
  it('파일 이름이 규칙과 달라도 메타데이터로 찾아 연다', async () => {
    const { sk } = await open()
    const old = await fileDoc(sk.version.crtime)
    const crtime = sk.version.crtime + 1
    const id = await upload('SEW_NONSTANDARD_NAME', { ...old.metadata, crtime }, '')
    try {
      const res = await open(crtime)
      expect(res.status).toBe(200)
      expect(res.sk.version.crtime).toBe(crtime)
    } finally {
      await bucket().delete(id)
    }
  })
  it('없는 판은 404', async () => {
    expect((await open(1)).status).toBe(404)
  })
  // 드라이버는 중간 조각이 빠지면 오류를 내지만 뒤쪽 조각이 빠지면 오류 없이 끝낸다. 어느 쪽이든 깨진 파일이다.
  it.each([
    ['조각이 전부 없음', 10, {}],
    ['뒤쪽 조각이 없음', 300 * 1024, { n: 1 }],
    ['중간 조각이 없음', 600 * 1024, { n: 1 }]
  ])('GridFS 파일이 깨지면(%s) 422 DATA_INVALID 이고 캐시에 남지 않는다', async (_, size, chunkFilter) => {
    const { earsConnection } = require('../../../../shared/db/connection')
    const { sk } = await open()
    const old = await fileDoc(sk.version.crtime)
    const crtime = sk.version.crtime + 2
    const content = `{"TargetSnapshotList":["${'A'.repeat(size)}"]}`
    const id = await upload(`${meta.process}.${meta.model}.${meta.name}.${crtime}`, { ...old.metadata, crtime }, content)
    try {
      await earsConnection.db.collection('fs.chunks').deleteMany({ files_id: id, ...chunkFilter })
      for (let i = 0; i < 2; i++) { // 두 번째도 같다 — 깨진 결과가 캐시에 남지 않는다
        const res = await get(`${PATH}/versions/${crtime}`)
        expect(res.status).toBe(422)
        expect((await res.json()).code).toBe('DATA_INVALID')
      }
    } finally {
      await bucket().delete(id)
    }
  })
})
