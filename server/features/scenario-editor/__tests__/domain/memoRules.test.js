// 메모 규칙 — 글 검사, 운영 문서 읽기, 같은 키에서 하나 고르기 (P3 설계 §4.4·§5.5·§7)
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { MEMO_MAX, checkMemoText, readMemoDoc, pickLatest, isPlainSnapshotName } = require('../../domain/memoRules')

const NAME = '1762820000123_[412][388].png'
const doc = (over = {}) => ({
  _id: 'a1', singleid: 'kim', eqpid: 'E1', snapshotTimestamp: new Date(1762830000000), process: 'CVD', memo: '알람 창이 가려짐',
  filename: NAME, hiddensnapshot: '0', ...over
})

describe('checkMemoText — 메모 글 검사', () => {
  it('앞뒤 공백을 지운 글을 준다', () => {
    expect(checkMemoText('  가 나  \n')).toEqual({ text: '가 나' })
  })
  it('128자까지 — 공백을 지운 뒤에 센다', () => {
    expect(MEMO_MAX).toBe(128)
    expect(checkMemoText(` ${'가'.repeat(128)} `)).toEqual({ text: '가'.repeat(128) })
    expect(checkMemoText('가'.repeat(129))).toEqual({ code: 'MEMO_TOO_LONG' })
  })
  it("작은따옴표는 쓸 수 없다(데스크톱이 그런 메모를 저장하지 못한다)", () => {
    expect(checkMemoText("it's")).toEqual({ code: 'MEMO_QUOTE' })
    expect(checkMemoText('큰따옴표 " 는 된다')).toEqual({ text: '큰따옴표 " 는 된다' })
  })
  it('빈 글·공백뿐·글자가 아닌 값은 MEMO_EMPTY', () => {
    for (const v of ['', '   ', '\n\t', null, undefined, 7, {}, ['a']]) expect(checkMemoText(v), JSON.stringify(v)).toEqual({ code: 'MEMO_EMPTY' })
  })
})

describe('isPlainSnapshotName — 메모를 쓸 수 있는 파일 이름(스냅샷 서버가 만드는 꼴 그대로)', () => {
  it('13자리 ms, 앞자리 0 이 없는 좌표·태그 값', () => {
    for (const ok of ['1762820000123_[412][388].png', '1762820000123_[0][0].png', '1762820000123_[9999][1762820000000].png']) expect(isPlainSnapshotName(ok), ok).toBe(true)
  })
  it('ms 자릿수가 다르거나 앞자리 0, 좌표의 앞자리 0, 꼴이 아닌 이름은 아니다 — 데스크톱이 읽다 멈추거나 어느 목록에도 안 보이는 문서가 된다', () => {
    for (const bad of [
      '0001762820000123_[1][2].png', '17628200001239_[1][2].png', '999999999999999_[1][1].png', '176282000012_[1][2].png', '0762820000123_[1][2].png',
      '1762820000123_[01][2].png', '1762820000123_[1][02].png', '1762820000123_[1][2].PNG', '1762820000123_[1][2].png\n', 'memo.bin', null, 7
    ]) expect(isPlainSnapshotName(bad), String(bad)).toBe(false)
  })
})

describe('readMemoDoc — 운영 문서 한 건 읽기', () => {
  it('데스크톱이 쓴 꼴(일곱 필드)', () => {
    expect(readMemoDoc(doc())).toEqual({
      id: 'a1', eqpId: 'E1', fileName: NAME, ms: 1762820000123, text: '알람 창이 가려짐', author: 'kim', writtenMs: 1762830000000,
      hidden: false, editedBy: null, editedMs: null
    })
  })
  it('웹이 고친 꼴 — 고친 사람·시각', () => {
    const r = readMemoDoc(doc({ webEditedBy: 'lee', webEditedAt: new Date(1762840000000) }))
    expect([r.editedBy, r.editedMs]).toEqual(['lee', 1762840000000])
  })
  it('숨김은 hiddensnapshot 이 글자 "1" 일 때만', () => {
    expect(readMemoDoc(doc({ hiddensnapshot: '1' })).hidden).toBe(true)
    for (const v of ['0', 1, true, '2026-11-11 오전 9:00:00', undefined]) expect(readMemoDoc(doc({ hiddensnapshot: v })).hidden, String(v)).toBe(false)
  })
  it('작성자·쓴 때가 없거나 꼴이 달라도 읽는다 — 작성자 빈 글자, 쓴 때 null', () => {
    const r = readMemoDoc(doc({ singleid: undefined, snapshotTimestamp: '2026-11-11' }))
    expect([r.author, r.writtenMs]).toEqual(['', null])
    expect(readMemoDoc(doc({ singleid: 7, snapshotTimestamp: undefined, webEditedBy: 9, webEditedAt: 'x' }))).toMatchObject({ author: '', writtenMs: null, editedBy: null, editedMs: null })
    expect(readMemoDoc(doc({ snapshotTimestamp: new Date(NaN) })).writtenMs).toBeNull()
  })
  it('빈 메모 글도 읽는다(데스크톱이 남겼을 수 있다)', () => {
    expect(readMemoDoc(doc({ memo: '' })).text).toBe('')
  })
  it('틀린 문서는 null — 설비·파일 이름·메모가 글자가 아니거나 파일 이름이 스냅샷 꼴이 아님', () => {
    for (const bad of [
      doc({ eqpid: undefined }), doc({ eqpid: '' }), doc({ eqpid: 5 }), doc({ filename: undefined }), doc({ filename: 'memo.bin' }),
      doc({ filename: `${NAME}\n` }), doc({ memo: undefined }), doc({ memo: 3 }), doc({ _id: undefined }), null, 'x', 7
    ]) expect(readMemoDoc(bad), JSON.stringify(bad)).toBeNull()
  })
})

describe('pickLatest — 같은 파일 이름에서 하나', () => {
  const rec = (id, fileName, writtenMs) => ({ id, fileName, writtenMs })
  it('가장 늦게 쓴 것', () => {
    const m = pickLatest([rec('a', 'f1', 10), rec('b', 'f1', 30), rec('c', 'f1', 20), rec('d', 'f2', 5)])
    expect([...m].map(([k, v]) => [k, v.id])).toEqual([['f1', 'b'], ['f2', 'd']])
  })
  it('쓴 때가 없는 것은 가장 이른 것으로 본다', () => {
    expect(pickLatest([rec('a', 'f1', null), rec('b', 'f1', 1)]).get('f1').id).toBe('b')
    expect(pickLatest([rec('a', 'f1', 1), rec('b', 'f1', null)]).get('f1').id).toBe('a')
  })
  it('쓴 때가 같으면 id 가 뒤인 것(받은 순서와 무관)', () => {
    expect(pickLatest([rec('b', 'f1', 1), rec('a', 'f1', 1)]).get('f1').id).toBe('b')
    expect(pickLatest([rec('a', 'f1', null), rec('b', 'f1', null)]).get('f1').id).toBe('b')
  })
  it('빈 목록', () => expect(pickLatest([]).size).toBe(0))
})
