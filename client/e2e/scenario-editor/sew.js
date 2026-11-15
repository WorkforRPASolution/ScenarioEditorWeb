// 저장 E2E(p2-save) 도우미 — 서버 API 로 시험 시나리오 준비·확인, 고장 주입 중계 모드, SEW_W_ 정리.
// 시험 시나리오는 SEW_W_<시각>_<화면>_<표시> 이름으로 만들고 시드 시나리오(basic)는 읽기만 한다.
// 정리는 배포 통합 시험과 같은 tools/infra/sew-w-cleanup.js 를 쓴다(server/.env 의 EARS·웹 DB·Redis·InterfaceServer 가 루프백이 아니거나
// 웹 전용 DB 가 SE_WEB_DEV 가 아니면 아무것도 지우지 않는다 — 사내 프로필 .env 로 돌려 사내 SEW_W_ 를 지우지 않게).
import { request as pwRequest, expect, test } from '@playwright/test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ROOT, API_URL, FAULT_CONTROL_URL, serverEnv } from '../env.js'

const requireTools = createRequire(join(ROOT, 'tools/package.json'))
const { cleanupSewW, cleanupSewMemos, assertLocalTargets, TEST_USERS } = requireTools('./infra/sew-w-cleanup.js')

export const CVD = { process: 'SEWCVD', model: 'SEWMODELA' }
export const SOURCE = { ...CVD, name: 'ALL_CONDITIONS' } // 1 이미지 · 2 OCR · 3 대기 · 4 설비 상태, 손대지 않고 배포해도 막힘이 없다

// SEW_W_<시각 36진수>_<1600|1920>_<표시> — 화면 크기 두 벌과 되풀이 실행이 서로 겹치지 않는다(50자 안)
export const sewName = (tag) => `SEW_W_${Date.now().toString(36).toUpperCase()}_${test.info().project.name.slice(-4)}_${tag}`
export const idOf = (k) => `${k.process}-${k.model}-${k.name}`
export const urlOf = (k, v = 'current') => `/scenario-editor?p=${encodeURIComponent(k.process)}&m=${encodeURIComponent(k.model)}&n=${encodeURIComponent(k.name)}&v=${v}`

// ── 서버 API(127.0.0.1:3100, 개발용 사용자 머리글 X-SE-User — 시험 서버는 SE_DEV_USER_OVERRIDE=1) ──
export async function apiAs(user = 'sew_master') {
  const ctx = await pwRequest.newContext({ baseURL: API_URL, extraHTTPHeaders: { 'X-SE-User': user } })
  const enc = encodeURIComponent
  const path = (k) => `scenarios/${enc(k.process)}/${enc(k.model)}/${enc(k.name)}`
  const json = async (res, what) => {
    const text = await res.text()
    expect(res.status(), `${what}: ${text.slice(0, 300)}`).toBe(200)
    return JSON.parse(text).data
  }
  const api = {
    open: async (k, crtime = 'current') => json(await ctx.get(`${path(k)}/versions/${crtime}`), `열기 ${idOf(k)}`),
    versions: async (k) => json(await ctx.get(`${path(k)}/versions`), `버전 ${idOf(k)}`),
    list: async (process, model) => json(await ctx.get('scenarios', { params: { process, model } }), `목록 ${process}-${model}`),
    drafts: async (process, model) => json(await ctx.get('drafts', { params: { process, model } }), '내 초안'),
    async deploy(meta) {
      const data = await json(await ctx.post('deploy', { multipart: { meta: JSON.stringify(meta) }, timeout: 120_000 }), `배포 ${idOf(meta.target)}`)
      expect(data.result).toBe('ok')
      return data
    },
    // 시나리오 지우기(확인 이름 = 이름). 내 초안은 건드리지 않는다
    remove: async (k) => json(await ctx.delete(path(k), { data: { confirmName: k.name }, timeout: 60_000 }), `지우기 ${idOf(k)}`),
    // 판 하나를 열어(edit 로 작업본을 고쳐) target 에 배포한다 — 다른 이름이면 복사, 같은 이름이면 새 판
    async deployFrom(from, target, edit = null, crtime = 'current') {
      const sk = await api.open(from, crtime)
      const scenario = structuredClone(sk.edited)
      if (edit) edit(scenario)
      return api.deploy({ target, propertyRev: sk.propertyRev, scenario, requestId: randomUUID() })
    },
    dispose: () => ctx.dispose()
  }
  return api
}

// 스텝 비교용 — 그림 URL 은 시나리오 이름·판·파일 id 를 품어 판마다 다르다(참조 from·id 로 비교)
export const noUrls = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'url' ? undefined : x)))

// ── 고장 주입 중계(playwright.config.js 가 띄운 tools/infra/fault-proxy-server.js) ──
export async function proxyMode(mode) {
  const res = await fetch(`${FAULT_CONTROL_URL}/mode/${mode}`, { method: 'PUT' })
  expect(res.status, `중계 모드 ${mode}`).toBe(200)
}

// ── EARS·웹 전용 DB·Redis 직접 연결(정리·남은 것 세기·성과 보존 확인용 준비) ──
let clients = null
export async function db() {
  if (clients) return clients
  const env = serverEnv()
  if (!env.WEBMANAGER_DB_URI) throw new Error('server/.env 의 WEBMANAGER_DB_URI 가 비었다 — SE_WEB_DEV 여야 한다(CLAUDE.md 통합 시험)')
  assertLocalTargets(env) // 연결하기 전에 — 루프백이 아니면 던진다
  const { MongoClient, GridFSBucket } = requireTools('mongodb')
  const Redis = requireTools('ioredis')
  const ears = new MongoClient(env.MONGODB_URI || 'mongodb://localhost:27017/EARS')
  const web = new MongoClient(env.WEBMANAGER_DB_URI)
  await ears.connect()
  await web.connect()
  const redis = new Redis(env.REDIS_URL || 'redis://:visuallove@localhost:6379/0')
  clients = { ears, web, redis, db: ears.db(), webDb: web.db(), GridFSBucket }
  return clients
}

export async function cleanup() {
  const c = await db()
  return cleanupSewW({ env: serverEnv(), db: c.db, webDb: c.webDb, redis: c.redis, GridFSBucket: c.GridFSBucket })
}

// 스냅샷 메모 E2E(p3-snapshot ⑤): 시험 설비(SEWT_)의 메모만 지운다 — 루프백이 아니면 던진다. 남은 수도 센다.
export async function cleanupMemos() {
  const c = await db()
  return cleanupSewMemos({ env: serverEnv(), db: c.db })
}
export async function memosLeft() {
  const c = await db()
  return c.db.collection('ARS_USER_MEMO').countDocuments({ eqpid: /^SEWT_/ })
}

// 정리 뒤 남은 SEW_W_ 데이터(0 이어야 한다)
export async function leftovers() {
  const c = await db()
  let redisFields = 0
  for (const key of await c.redis.keys('SEW*-*')) {
    if ((await c.redis.type(key)) === 'hash') redisFields += (await c.redis.hkeys(key)).filter((f) => f.startsWith('SEW_W_')).length
  }
  return {
    scProperty: await c.db.collection('SC_PROPERTY').countDocuments({ process: /^SEW/, scname: /^SEW_W_/ }),
    gridfsFiles: await c.db.collection('fs.files').countDocuments({ 'metadata.process': /^SEW/, 'metadata.name': /^SEW_W_/ }),
    redisFields,
    drafts: await c.webDb.collection('SCENARIO_EDITOR_DRAFTS').countDocuments({ owner: { $in: TEST_USERS } }),
    deploys: await c.webDb.collection('SCENARIO_EDITOR_DEPLOYS').countDocuments({ user: { $in: TEST_USERS } }),
    draftImages: await c.webDb.collection('seDraftImages.files').countDocuments({ 'metadata.owner': { $in: TEST_USERS } })
  }
}
export const NONE_LEFT = { scProperty: 0, gridfsFiles: 0, redisFields: 0, drafts: 0, deploys: 0, draftImages: 0 }

export async function closeDb() {
  if (!clients) return
  const c = clients
  clients = null
  await c.ears.close()
  await c.web.close()
  c.redis.disconnect()
}
