// 스냅샷 파일 이름 `{ms}_[{x}][{y}].png` 해석 (P3 설계 §3·§7).
import { describe, it, expect } from 'vitest'
import { isSnapshotName, parseSnapshotName } from '../../domain/snapshotName'

describe('snapshotName — 파일 이름 해석', () => {
  it('클릭 스냅샷: 좌표를 수로, txn 없음', () => {
    expect(parseSnapshotName('1762820000123_[412][388].png')).toEqual({
      fileName: '1762820000123_[412][388].png', ms: 1762820000123, kind: 'click', tag: null, x: 412, y: 388, txn: null, hasHistory: false
    })
  })

  it('태그 스냅샷: 코드 다섯 개가 정확히 같을 때만, txn 은 글자', () => {
    const table = [['9999', 'start'], ['9990', 'success'], ['9991', 'stop'], ['9992', 'fail'], ['9993', 'skip']]
    for (const [code, tag] of table) {
      const fileName = `1762820000123_[${code}][1762820000001].png`
      expect(parseSnapshotName(fileName), code).toEqual({
        fileName, ms: 1762820000123, kind: 'tag', tag, x: null, y: null, txn: '1762820000001', hasHistory: true
      })
    }
  })

  it('이력 대상은 태그이고 txn 이 99999 이상일 때만', () => {
    expect(parseSnapshotName('1762820000123_[9990][5].png')).toMatchObject({ kind: 'tag', tag: 'success', txn: '5', hasHistory: false })
    expect(parseSnapshotName('1762820000123_[9990][99998].png').hasHistory).toBe(false)
    expect(parseSnapshotName('1762820000123_[9990][99999].png').hasHistory).toBe(true)
    expect(parseSnapshotName('1762820000123_[9990][9999999999999999].png')).toMatchObject({ txn: '9999999999999999', hasHistory: true })
  })

  it('코드가 아닌 큰 x 는 클릭이다', () => {
    expect(parseSnapshotName('1762820000123_[9994][10].png')).toMatchObject({ kind: 'click', tag: null, x: 9994, y: 10, txn: null, hasHistory: false })
    expect(parseSnapshotName('1762820000123_[9000][10].png')).toMatchObject({ kind: 'click', x: 9000, y: 10 })
    expect(parseSnapshotName('1762820000123_[99990][100000].png')).toMatchObject({ kind: 'click', x: 99990, hasHistory: false })
  })

  it('꼴이 아니면 null', () => {
    const bad = [
      '1762820000123_[412][388].PNG', // 대문자 확장자
      '1762820000123_[412][388]', // 확장자 없음
      '1762820000123[412][388].png', // _ 없음
      '1762820000123_[412].png', // [x] 하나뿐
      '1762820000123_[-4][388].png', // 음수 좌표
      ' 1762820000123_[412][388].png', // 앞 공백
      '1762820000123_[412][388].png\n', // 뒤 줄바꿈
      '12345678901234567_[412][388].png', // ms 17자리
      '1762820000123_[1234567890][388].png', // x 10자리
      '1762820000123_[412][12345678901234567].png', // y 17자리
      '_[412][388].png',
      '../1762820000123_[412][388].png',
      '',
      null, undefined, 1762820000123, {}, ['1762820000123_[412][388].png']
    ]
    for (const v of bad) {
      expect(parseSnapshotName(v), JSON.stringify(v)).toBeNull()
      expect(isSnapshotName(v), JSON.stringify(v)).toBe(false)
    }
  })

  it('isSnapshotName: 꼴이 맞으면 true', () => {
    expect(isSnapshotName('1762820000123_[412][388].png')).toBe(true)
    expect(isSnapshotName('5_[0][0].png')).toBe(true)
  })
})
