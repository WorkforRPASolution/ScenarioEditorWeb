import { describe, it, expect, vi } from 'vitest'
import { createListService } from '../service/listService'
import { createVersionService } from '../service/versionService'
import { createOpenService } from '../service/openService'
import { seError } from '../errors'

// 공정 권한 게이트: assertAllowed 가 거부하면 PROCESS_FORBIDDEN 이 나오고, 저장소·Redis·GridFS·이미지 캐시는 한 번도 부르지 않는다.
function spies() {
  const all = []
  const spy = (name) => { const f = vi.fn(async () => { throw new Error(`${name} 를 부르면 안 된다`) }); all.push([name, f]); return f }
  const deps = {
    repo: { findScenarioDocs: spy('repo.findScenarioDocs'), findScenarioKeyDocs: spy('repo.findScenarioKeyDocs') },
    hash: { hkeys: spy('hash.hkeys') },
    gridfs: { findCrtimes: spy('gridfs.findCrtimes'), findVersion: spy('gridfs.findVersion'), readContent: spy('gridfs.readContent') },
    imageCache: { readSkeleton: spy('imageCache.readSkeleton'), store: spy('imageCache.store'), imagePath: spy('imageCache.imagePath') },
    scopes: { assertAllowed: vi.fn(async () => { throw seError(403, 'PROCESS_FORBIDDEN', '공정 권한 밖의 공정·모델입니다') }) },
    log: { info() {}, warn() {} }
  }
  const called = () => all.filter(([, f]) => f.mock.calls.length).map(([n]) => n)
  return { deps, called }
}

const user = { singleid: 'sew_cvd' }
const FORBIDDEN = { statusCode: 403, code: 'PROCESS_FORBIDDEN' }

describe('공정 권한 게이트 — 거부되면 데이터 원천을 건드리지 않는다', () => {
  it('목록', async () => {
    const { deps, called } = spies()
    await expect(createListService(deps).list(user, 'SEWETCH', 'SEWMODELA')).rejects.toMatchObject(FORBIDDEN)
    expect(deps.scopes.assertAllowed).toHaveBeenCalledWith(user, 'SEWETCH', 'SEWMODELA')
    expect(called()).toEqual([])
  })
  it('버전 목록', async () => {
    const { deps, called } = spies()
    await expect(createVersionService(deps).versions(user, 'SEWETCH', 'SEWMODELA', 'EQP_STATE')).rejects.toMatchObject(FORBIDDEN)
    expect(deps.scopes.assertAllowed).toHaveBeenCalledWith(user, 'SEWETCH', 'SEWMODELA')
    expect(called()).toEqual([])
  })
  it('열기(current·crtime)', async () => {
    for (const v of ['current', '1730000000100']) {
      const { deps, called } = spies()
      await expect(createOpenService(deps).open(user, 'SEWETCH', 'SEWMODELA', 'EQP_STATE', v)).rejects.toMatchObject(FORBIDDEN)
      expect(deps.scopes.assertAllowed).toHaveBeenCalledWith(user, 'SEWETCH', 'SEWMODELA')
      expect(called()).toEqual([])
    }
  })
  it('이미지', async () => {
    const { deps, called } = spies()
    await expect(createOpenService(deps).imagePath(user, 'SEWETCH', 'SEWMODELA', 'EQP_STATE', 1730000000100, 's0-bi')).rejects.toMatchObject(FORBIDDEN)
    expect(deps.scopes.assertAllowed).toHaveBeenCalledWith(user, 'SEWETCH', 'SEWMODELA')
    expect(called()).toEqual([])
  })
})
