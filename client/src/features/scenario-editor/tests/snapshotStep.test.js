// 스냅샷에서 스텝 만들기의 규칙 (P3 설계 §4.8)
import { describe, it, expect } from 'vitest'
import { SNAPSHOT_BASE_MAX_BYTES, snapshotKey, snapshotBaseProblem } from '../editor/snapshotStep'

describe('snapshotStep', () => {
  it('같은 스냅샷 = 같은 설비·같은 파일 이름', () => {
    expect(snapshotKey('EQP1', '1_[2][3].png')).toBe(snapshotKey('EQP1', '1_[2][3].png'))
    expect(snapshotKey('EQP1', '1_[2][3].png')).not.toBe(snapshotKey('EQP2', '1_[2][3].png'))
    expect(snapshotKey('EQP1', '1_[2][3].png')).not.toBe(snapshotKey('EQP1', '1_[2][4].png'))
    // 설비 이름과 파일 이름의 경계가 섞이지 않는다
    expect(snapshotKey('A', 'B1_[2][3].png')).not.toBe(snapshotKey('AB', '1_[2][3].png'))
  })
  it('기준 화면으로 쓸 수 없는 까닭: 그림이 없음(none)·서버가 받는 한 장 크기를 넘음(tooLarge)', () => {
    const blob = new Blob(['png'])
    expect(snapshotBaseProblem({ eqpId: 'E', fileName: 'f.png', blob })).toBe(null)
    expect(snapshotBaseProblem(null)).toBe('none')
    expect(snapshotBaseProblem({ eqpId: 'E', fileName: 'f.png', blob: 'x' })).toBe('none')
    expect(snapshotBaseProblem({ eqpId: 'E', fileName: 'f.png', blob: new Blob([]) })).toBe('none')
    expect(snapshotBaseProblem({ eqpId: '', fileName: 'f.png', blob })).toBe('none')
    expect(snapshotBaseProblem({ eqpId: 'E', fileName: '', blob })).toBe('none')
    expect(SNAPSHOT_BASE_MAX_BYTES).toBe(10 * 1048576) // 서버 upload.js MAX_FILE
    const sized = (size) => Object.defineProperty(new Blob(['x']), 'size', { value: size })
    expect(snapshotBaseProblem({ eqpId: 'E', fileName: 'f.png', blob: sized(SNAPSHOT_BASE_MAX_BYTES) })).toBe(null)
    expect(snapshotBaseProblem({ eqpId: 'E', fileName: 'f.png', blob: sized(SNAPSHOT_BASE_MAX_BYTES + 1) })).toBe('tooLarge')
  })
})
