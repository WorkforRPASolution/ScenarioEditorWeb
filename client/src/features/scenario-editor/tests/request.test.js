import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beginSession } from '../editor/session'
import { buildMeta, buildFormData, uploadsToSend } from '../editor/request'
import { imageStep, noneStep } from './panelFixture'

// 서버 계약(편집 시나리오 해석)을 그대로 불러 비교한다 — 서버 domain 은 이 저장소 코드이고 바깥 의존이 없다.
const serverRequire = createRequire(import.meta.url)
const { parseEditedScenario } = serverRequire(join(__dirname, '../../../../../server/features/scenario-editor/domain/editedScenario.js'))

const SOURCE = { process: 'P', model: 'M', name: 'N', crtime: 7, fileId: 'f1' }
const edited = (steps) => ({ source: SOURCE, headCrtime: 7, header: { description: '메일 제목', timeoutLimit: '600' }, steps, property: { IsEnabled: true } })
const skeleton = (e) => ({ process: 'P', model: 'M', name: 'N', headCrtime: 7, propertyRev: 'rev1', version: { crtime: 7, isCurrent: true, fileId: 'f1' }, edited: e })
const sessionOf = (steps) => beginSession(skeleton(edited(steps)), { canWrite: true })
const withWorking = (s, steps) => ({ ...s, working: { ...s.working, steps } })

const upload = (tempId) => ({ from: 'upload', tempId })
const newImage = (uid, train, base = { from: 'source', id: 's0-bi' }) => imageStep(0, { uid, origin: null, images: { train, base } })

describe('buildMeta', () => {
  it('서버 meta 모양: target·propertyRev·scenario — 최상위 source 는 싣지 않는다(R-P6)', () => {
    const s = sessionOf([imageStep(0), noneStep(1)])
    const { meta } = buildMeta(s)
    expect(Object.keys(meta).sort()).toEqual(['propertyRev', 'scenario', 'target'])
    expect(meta.target).toEqual({ process: 'P', model: 'M', name: 'N' })
    expect(meta.propertyRev).toBe('rev1')
    expect(meta.scenario.source).toEqual(SOURCE)
    expect(meta.scenario.headCrtime).toBe(7)
  })

  it('scenario 는 서버 parseEditedScenario 가 받는 키만 — 작업본에 다른 키가 있어도 싣지 않는다', () => {
    const s = sessionOf([imageStep(0)])
    const stray = { ...s, working: { ...s.working, notes: [{ code: 'X' }], draftOnly: 1 } }
    const { meta } = buildMeta(stray)
    expect(Object.keys(meta.scenario).sort()).toEqual(['headCrtime', 'header', 'property', 'source', 'steps'])
  })

  it('서버가 그대로 받는다 — 해석 결과가 보낸 값과 같다(새 스텝·올릴 그림·다른 판 그림·미해결 갈 곳 포함)', () => {
    const s = sessionOf([imageStep(0), noneStep(1)])
    const other = { from: 'other', process: 'P', model: 'M2', name: 'O', crtime: 3, fileId: 'f9', id: 's0-bi' }
    const steps = [
      s.working.steps[0],
      newImage('n1', { 0: upload('tabc') }),
      { ...noneStep(1), uid: 'p2', origin: null, next: { onTrue: { kind: 'unresolved', value: 3 }, onFalse: { kind: 'step', uid: 's0' } } },
      newImage('p3', { 0: { ...other, id: 's0-train-0' } }, other),
      s.working.steps[1]
    ]
    const { meta } = buildMeta(withWorking(s, steps))
    const wire = JSON.parse(JSON.stringify(meta.scenario))
    expect(parseEditedScenario(wire)).toEqual(wire)
  })

  it('target 을 주면 그것을, extra 는 최상위에 더한다', () => {
    const s = sessionOf([noneStep(0)])
    const { meta } = buildMeta(s, { target: { process: 'P', model: 'M3', name: 'COPY' }, extra: { requestId: 'r-1', force: true } })
    expect(meta.target).toEqual({ process: 'P', model: 'M3', name: 'COPY' })
    expect(meta).toMatchObject({ requestId: 'r-1', force: true })
  })

  it('저장 기준이 없는 새 시나리오(source null)는 target 을 받아 쓴다', () => {
    const s = beginSession({ process: 'P', model: 'M', name: 'NEW', headCrtime: null, propertyRev: null, version: {}, edited: { ...edited([noneStep(0)]), source: null, headCrtime: null } }, { canWrite: true })
    const { meta } = buildMeta(s, { target: { process: 'P', model: 'M', name: 'NEW' } })
    expect(meta.scenario.source).toBeNull()
    expect(meta.scenario.headCrtime).toBeNull()
    expect(meta.propertyRev).toBeNull()
    expect(meta.target).toEqual({ process: 'P', model: 'M', name: 'NEW' })
  })

  it('uploadsUsed = 작업본이 실제로 가리키는 올릴 그림 tempId(찾을 그림·기준 화면, 겹치지 않게)', () => {
    const s = sessionOf([imageStep(0)])
    const steps = [
      newImage('n1', { 0: upload('ta'), 1: upload('tb') }, upload('tbase')),
      newImage('n2', { 0: upload('ta') }),
      noneStep(1)
    ]
    const { uploadsUsed } = buildMeta(withWorking(s, steps))
    expect(uploadsUsed).toEqual(['tbase', 'ta', 'tb'])
    expect(buildMeta(s).uploadsUsed).toEqual([])
  })
})

describe('buildFormData', () => {
  const png = (n) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, n])], { type: 'image/png' })

  it('필드 meta(JSON 문자열)와 쓰는 그림만 img:<tempId> — 잡다 버린 그림은 싣지 않는다', async () => {
    const meta = { target: { process: 'P', model: 'M', name: 'N' }, propertyRev: null, scenario: { steps: [] } }
    const uploads = new Map([['ta', png(1)], ['orphan', png(2)]])
    const fd = buildFormData(meta, uploads, ['ta'])
    expect(JSON.parse(fd.get('meta'))).toEqual(meta)
    expect([...fd.keys()].sort()).toEqual(['img:ta', 'meta'])
    // 파일 이름은 서버가 보지 않는다(필드 이름의 tempId 와 내용만) — happy-dom 은 Blob 에 준 이름을 버리고 'blob' 으로 둔다
    const file = fd.get('img:ta')
    expect(file).toBeInstanceOf(Blob)
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]))
  })

  it('쓰는 tempId 의 그림이 없으면 던진다(빠진 채 보내지 않는다)', () => {
    expect(() => buildFormData({ scenario: {} }, new Map(), ['gone'])).toThrow(/gone/)
  })

  it('uploadsToSend: 초안에서 이어 연 세션은 로컬 Blob 이 없는 그림(서버 초안 그림)을 빼고, 초안이 없으면 그대로 둔다(빠진 그림은 buildFormData 가 막는다)', () => {
    const uploads = new Map([['tNew', new Blob(['x'])]])
    expect(uploadsToSend(['tDraft', 'tNew'], uploads, 'd1')).toEqual(['tNew'])
    expect(uploadsToSend(['tDraft', 'tNew'], uploads, null)).toEqual(['tDraft', 'tNew'])
  })
})
