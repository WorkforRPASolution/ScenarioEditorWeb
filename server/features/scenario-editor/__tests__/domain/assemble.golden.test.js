// 완료 조건 1(설계 §2): 생성기 basic·anomaly 의 모든 시나리오·판을 열어 아무것도 고치지 않고 조립하면 저장 글자와 같다.
// big 은 단위 시험에 너무 느려 뺀다(BIG_200 은 tools/measure 로 잰다).
import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSkeleton, isImage, baseImageId } from '../../domain/skeleton'
import { editedFromSkeleton } from '../../domain/editedScenario'
import { assembleScenario, assembleProperty } from '../../domain/assemble'
import { backupInfoChunks } from '../../domain/csharpJson'

const require = createRequire(import.meta.url)
const { generate, SETS } = require('../../../../../tools/scenario-gen/lib/generate') // 시험만 tools 를 읽는다

const SET_NAMES = ['basic', 'anomaly']
const OUT = mkdtempSync(join(tmpdir(), 'sew-golden-'))
const results = generate(SET_NAMES, OUT)
afterAll(() => rmSync(OUT, { recursive: true, force: true }))

const read = (dir, f) => readFileSync(join(dir, f), 'utf8')

// 서버 열기(openService.unpack)와 같은 규칙: BI 항목은 그림이면 s{i}-bi 로 떼고, 아니면 literal. 운영 속성은 refreshPropertyParts 가 붙인다.
function openLikeServer(meta, body, bi, propertyDoc) {
  const present = new Set()
  const literals = new Map()
  const biImages = new Map()
  const list = bi.TargetSnapshotList
  list.forEach((v, i) => { if (isImage(v)) { present.add(i); biImages.set(baseImageId(i), v) } else literals.set(i, v) })
  const { skeleton, images } = buildSkeleton({ process: meta.process, model: meta.model, name: meta.name, crtime: 1730000000000, isCurrent: true, body,
    baseImages: { parseFailed: false, present, literals, count: list.length || null }, propertyDoc, performanceDoc: null, imageBaseUrl: '/img' })
  return { skeleton, images, biImages }
}

const byId = (images, biImages) => {
  const table = new Map([...images.map((im) => [im.id, im.base64]), ...biImages])
  return async (ref) => {
    if (ref.from !== 'source' || !table.has(ref.id)) throw new Error(`그림 없음 ${JSON.stringify(ref)}`)
    return table.get(ref.id)
  }
}

describe('생성기 왕복', () => {
  it('basic·anomaly 시나리오를 모두 만들었다', () => {
    expect(results.length).toBe(SET_NAMES.reduce((n, s) => n + SETS[s]().length, 0))
    expect(results.length).toBeGreaterThan(0)
  })

  // 빼는 시나리오 없음: anomaly 의 깨진 값(동작 -1·Operation 3·범위 밖 번호 -2 등)도 C# 직렬화기가 쓸 수 있는 int 값이다.
  for (const { dir, meta } of results) {
    for (let v = 1; v <= meta.versions; v++) {
      it(`${meta.set}/${meta.name} v${v} 왕복`, async () => {
        const bodyText = read(dir, `body.v${v}.json`)
        const biText = read(dir, `bi.v${v}.json`)
        const propText = read(dir, `property.v${v}.json`)
        const bi = JSON.parse(biText)
        const { skeleton, images, biImages } = openLikeServer(meta, JSON.parse(bodyText), bi, JSON.parse(propText))
        const resolveImage = byId(images, biImages)
        const r = await assembleScenario(editedFromSkeleton(skeleton), skeleton, { id: skeleton.id, resolveImage })
        expect(r.bodyString).toBe(bodyText)
        expect(assembleProperty(skeleton.property, { id: skeleton.id })).toBe(propText)
        expect(r.changed.size).toBe(0)
        // BI 항목을 풀면 원래 목록이고, 조각을 이으면 생성기가 쓴 BI 글자와 같다(ID 는 생성기가 쓴 그대로).
        const resolved = []
        for (const e of r.biEntries) resolved.push(e.kind === 'image' ? await resolveImage(e.ref) : e.value)
        expect(resolved).toEqual(bi.TargetSnapshotList)
        let joined = ''
        for await (const c of backupInfoChunks(bi.ID, r.biEntries, resolveImage)) joined += c
        expect(joined).toBe(biText)
      })
    }
  }
})

// 고친 스텝 길(changedStep)도 저장값을 지키는지: 모든 스텝의 descriptionToEmail 만 고치면, 그 칸 말고는 저장 본문과 같다(JSON 으로 비교).
describe('생성기 왕복 — 설명만 고친 스텝', () => {
  for (const { dir, meta } of results) {
    for (let v = 1; v <= meta.versions; v++) {
      it(`${meta.set}/${meta.name} v${v} 모든 스텝 설명만 고침`, async () => {
        const bodyText = read(dir, `body.v${v}.json`)
        const { skeleton, images, biImages } = openLikeServer(meta, JSON.parse(bodyText), JSON.parse(read(dir, `bi.v${v}.json`)), JSON.parse(read(dir, `property.v${v}.json`)))
        const e = editedFromSkeleton(skeleton)
        e.steps.forEach((s, i) => { s.descriptionToEmail = `${s.descriptionToEmail ?? ''}#고침${i}` })
        const r = await assembleScenario(e, skeleton, { id: skeleton.id, resolveImage: byId(images, biImages) })
        expect(r.changed.size).toBe(e.steps.length)
        const got = JSON.parse(r.bodyString)
        const want = JSON.parse(bodyText)
        expect(got.Step).toHaveLength(want.Step.length)
        got.Step.forEach((st, i) => {
          expect(st.DescriptionToEmail).toBe(e.steps[i].descriptionToEmail)
          st.DescriptionToEmail = want.Step[i].DescriptionToEmail
        })
        expect(got).toEqual(want)
      })
    }
  }
})
