import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const { planHistory, seedHistory, cleanHistory, historyUrl } = require('../lib/history')
const { planSnapshots } = require('../lib/snapshots')
const { PHOTO } = require('../data/snapshots')
// 시험만 서버를 읽는다 — 이력을 넣는 txn 이 서버가 "이력 대상" 으로 보는 태그 스냅샷의 것인지 본다.
const { parseSnapshotName } = require('../../../server/features/scenario-editor/domain/snapshotName')

const kst = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms)
const NOW = kst(2026, 11, 16, 9, 0, 0)
const URL_OK = 'http://127.0.0.1:8082'

function fakeFetch(reply = () => ({ status: 200, body: '(true,success)' })) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const r = reply(calls.length)
    return { status: r.status, text: async () => r.body }
  }
  return { calls, fetch }
}

describe('planHistory — 넣을 이력 (순수 함수)', () => {
  const rows = planHistory(NOW)

  it('시험 태그 묶음의 txn 에 스텝 셋을 넣는다', () => {
    const tags = planSnapshots(NOW).map((r) => parseSnapshotName(r.fileName)).filter((p) => p.kind === 'tag' && p.tag === 'start')
    expect(rows.map((r) => r.step)).toEqual([1, 2, 3])
    expect([...new Set(rows.map((r) => r.eqpId))]).toEqual([PHOTO])
    const txn = String(rows[0].txn)
    expect(rows.every((r) => String(r.txn) === txn)).toBe(true)
    expect(tags.map((p) => p.txn)).toContain(txn)
    expect(tags.find((p) => p.txn === txn).hasHistory).toBe(true)
  })

  it('그림은 PNG 이고 크기가 적힌 값과 같다', () => {
    for (const r of rows) {
      const screen = PNG.sync.read(r.screen)
      const ref = PNG.sync.read(r.ref)
      expect([screen.width, screen.height]).toEqual(r.screenSize)
      expect([ref.width, ref.height]).toEqual(r.refSize)
    }
  })

  it('설명 하나에는 꺾쇠·앰퍼샌드·작은따옴표가 들어 있다 (이력 서버가 그대로 넣는 글)', () => {
    expect(rows.some((r) => r.text.includes('<') && r.text.includes('&') && r.text.includes("'"))).toBe(true)
  })
})

describe('seedHistory — AppendHistory 로 넣는다', () => {
  it('스텝마다 한 번 부르고 본문은 이력 서버가 받는 꼴이다', async () => {
    const rows = planHistory(NOW)
    const f = fakeFetch()
    expect(await seedHistory(URL_OK, rows, { fetch: f.fetch })).toEqual({ steps: 3 })
    expect(f.calls.map((c) => c.url)).toEqual(Array(3).fill('http://127.0.0.1:8082/ARS/AppendHistory'))
    expect(f.calls[0].init.method).toBe('POST')
    const b = f.calls[1].body
    expect(Object.keys(b).sort()).toEqual(['hostname', 'image', 'imageHeight', 'imageWidth', 'refimage', 'refimageHeight', 'refimageWidth', 'step', 'text', 'txn'])
    expect(b).toMatchObject({ hostname: PHOTO, txn: rows[1].txn, step: 2, text: rows[1].text, imageWidth: rows[1].screenSize[0], imageHeight: rows[1].screenSize[1], refimageWidth: rows[1].refSize[0], refimageHeight: rows[1].refSize[1] })
    expect(Buffer.from(b.image, 'base64').equals(rows[1].screen)).toBe(true)
    expect(Buffer.from(b.refimage, 'base64').equals(rows[1].ref)).toBe(true)
  })

  it('주소 끝의 빗금은 한 번만 붙는다', async () => {
    const f = fakeFetch()
    await seedHistory('http://localhost:8082/', planHistory(NOW).slice(0, 1), { fetch: f.fetch })
    expect(f.calls[0].url).toBe('http://localhost:8082/ARS/AppendHistory')
  })

  it('루프백이 아닌 이력 서버에는 넣지 않는다', async () => {
    const f = fakeFetch()
    await expect(seedHistory('http://10.20.30.40:8080', planHistory(NOW), { fetch: f.fetch })).rejects.toThrow(/루프백/)
    await expect(seedHistory('not a url', planHistory(NOW), { fetch: f.fetch })).rejects.toThrow(/루프백|주소/)
    expect(f.calls).toHaveLength(0)
  })

  it('시험 설비(SEWT_)가 아니면 넣지 않는다', async () => {
    const f = fakeFetch()
    const rows = planHistory(NOW).map((r) => ({ ...r, eqpId: 'REAL_EQP_01' }))
    await expect(seedHistory(URL_OK, rows, { fetch: f.fetch })).rejects.toThrow(/SEWT_/)
    expect(f.calls).toHaveLength(0)
  })

  it('이력 서버가 실패로 답하면 던진다', async () => {
    const bad = fakeFetch(() => ({ status: 200, body: '(false,boom)' }))
    await expect(seedHistory(URL_OK, planHistory(NOW), { fetch: bad.fetch })).rejects.toThrow(/AppendHistory/)
    const err = fakeFetch(() => ({ status: 500, body: 'x' }))
    await expect(seedHistory(URL_OK, planHistory(NOW), { fetch: err.fetch })).rejects.toThrow(/500/)
  })
})

describe('cleanHistory — 시험 설비의 이력만 지운다', () => {
  it('historylog 의 파티션 가운데 SEWT_ 설비 것만 키로 지운다', async () => {
    const calls = []
    const client = {
      execute: async (query, params, options) => {
        calls.push({ query, params, options })
        if (/select distinct/i.test(query)) {
          return { rows: [{ eqpid: 'SEWT_PHOTO_A01', txn: { toString: () => '1763254800000' } }, { eqpid: 'EQP001', txn: 7 }, { eqpid: 'SEWT_ETCH_B01', txn: 100000 }] }
        }
        return { rows: [] }
      }
    }
    expect(await cleanHistory(client)).toEqual({ partitions: 2 })
    const deletes = calls.filter((c) => /^delete from historylog/i.test(c.query))
    expect(deletes.map((c) => c.params[0])).toEqual(['SEWT_PHOTO_A01', 'SEWT_ETCH_B01'])
    expect(deletes.every((c) => /where eqpid = \? and txn = \?/.test(c.query) && c.options.prepare === true)).toBe(true)
    expect(String(deletes[0].params[1])).toBe('1763254800000')
  })
})

describe('historyUrl — 이력 서버 주소', () => {
  it('환경 변수가 먼저이고, 없으면 server/.env 글에서 읽는다. 비면 null', () => {
    expect(historyUrl({ HTTP_WEB_SERVER_URL: ' http://127.0.0.1:8082 ' }, 'HTTP_WEB_SERVER_URL=http://x')).toBe('http://127.0.0.1:8082')
    expect(historyUrl({}, 'A=1\nHTTP_WEB_SERVER_URL=http://localhost:8082\n')).toBe('http://localhost:8082')
    expect(historyUrl({}, 'HTTP_WEB_SERVER_URL=\n')).toBeNull()
    expect(historyUrl({}, null)).toBeNull()
  })
})
