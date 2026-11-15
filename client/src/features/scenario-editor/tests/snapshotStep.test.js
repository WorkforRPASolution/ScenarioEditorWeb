// 스냅샷에서 스텝 만들기의 규칙 (P3 설계 §4.8)
import { describe, it, expect } from 'vitest'
import { SNAPSHOT_BASE_MAX_BYTES, UPLOAD_TOTAL_MAX_BYTES, UPLOAD_MAX_FILES, snapshotKey, snapshotBaseProblem, uploadBudgetProblem } from '../editor/snapshotStep'

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
  it('한 번의 저장이 서버 한도를 넘게 되는가: 쓰는 올릴 그림 + 이 그림이 합계 50MB·200장을 넘으면 알린다', () => {
    const MB = 1048576
    const sized = (size) => Object.defineProperty(new Blob(['x']), 'size', { value: size })
    expect(UPLOAD_TOTAL_MAX_BYTES).toBe(50 * MB) // 서버 upload.js MAX_TOTAL
    expect(UPLOAD_MAX_FILES).toBe(200) // 서버 upload.js MAX_FILES
    expect(uploadBudgetProblem(sized(5 * MB), [])).toBe(null)
    expect(uploadBudgetProblem(sized(20 * MB), [sized(20 * MB), sized(10 * MB)])).toBe(null) // 꼭 50MB
    expect(uploadBudgetProblem(sized(20 * MB), [sized(20 * MB), sized(10 * MB), sized(1)])).toBe('total')
    const many = Array.from({ length: UPLOAD_MAX_FILES - 1 }, () => sized(10))
    expect(uploadBudgetProblem(sized(10), many)).toBe(null) // 200장째
    expect(uploadBudgetProblem(sized(10), [...many, sized(10)])).toBe('files')
    // Blob 이 아닌 것(서버 초안에만 있는 그림 — 다시 보내지 않는다)은 세지 않는다
    expect(uploadBudgetProblem(sized(40 * MB), [undefined, null, sized(5 * MB)])).toBe(null)
  })
})
