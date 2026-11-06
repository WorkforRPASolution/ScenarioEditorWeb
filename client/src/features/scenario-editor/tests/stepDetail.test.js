import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ imageUrl: (p) => p }))
import { actionDetails } from '../format'
import StepDetail from '../components/StepDetail.vue'
import CropView from '../components/CropView.vue'
import { useEditorStore } from '../stores/editorStore'
import { MESSAGES } from '../messages'

describe('actionDetails', () => {
  it('종류별 해석과 저장 값', () => {
    expect(actionDetails({ typeName: 'MouseLeftClick', raw: '24:12', click: { x: 24, y: 12, basis: 'trainImage' } }))
      .toEqual([['종류', '마우스 클릭'], ['좌표', '24:12'], ['기준', '학습 이미지 왼쪽 위'], ['저장 값', '24:12']])
    expect(actionDetails({ typeName: 'Keyboard', raw: 'x@@999', keyboard: { text: 'x', keys: [], unknownCodes: [999] } }))
      .toEqual([['종류', '키보드'], ['입력 문자열', 'x'], ['기능 키', '(없음)'], ['모르는 코드', '999'], ['저장 값', 'x@@999']])
    expect(actionDetails({ typeName: 'OICommand', raw: 'EQP_DOWN@10000@A', oiCommand: { command: 'EQP_DOWN', code: '10000', chamber: 'A' } }))
      .toEqual([['종류', 'O.I. Command'], ['명령', 'EQP_DOWN'], ['다운 코드', '10000'], ['챔버', 'A'], ['저장 값', 'EQP_DOWN@10000@A']])
    expect(actionDetails({ typeName: null, raw: '' })).toEqual([['종류', '알 수 없는 동작'], ['저장 값', '(빈 값)']])
  })
  it('조건 없음 클릭은 화면 (0,0) 안내, 화면 절대는 나오지 않는다', () => {
    const rows = actionDetails({ typeName: 'MouseLeftClick', raw: '-3:7', click: { x: -3, y: 7, basis: 'screenOrigin' } })
    expect(JSON.stringify(rows)).not.toContain('화면 절대')
    expect(rows[2]).toEqual(['기준', '실행 때 저장 좌표와 상관없이 화면 왼쪽 위(0,0)를 누릅니다'])
  })
  it('기준을 알 수 없는 클릭·예상 밖 값', () => {
    expect(actionDetails({ typeName: 'MouseLeftClick', raw: '1:1', click: { x: 1, y: 1, basis: 'unknown' } })[2])
      .toEqual(['기준', '이 조건에서는 클릭 기준을 알 수 없습니다'])
    expect(actionDetails({ typeName: 'MouseLeftClick', raw: '1:1', click: { x: 1, y: 1, basis: 'zzz' } })[2]).toEqual(['기준', 'zzz'])
  })
  it('에이전트 함수의 인자·출력이 배열이 아니어도 던지지 않는다', () => {
    expect(actionDetails({ typeName: 'NativeFunction', raw: 'f', native: { functionName: 'f', params: undefined, outputs: 'x' } }))
      .toEqual([['종류', '에이전트 함수'], ['함수', 'f'], ['인자', '(없음)'], ['출력', '(없음)'], ['저장 값', 'f']])
  })
})

describe('StepDetail', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const base = { uid: 's0', no: 1, descriptionToEmail: 'Reset 누르기', descriptionToDialog: '', isShowDialog: true, retry: { limit: 3, intervalMs: 2000 },
    notes: [], condition: { kind: 'none', skipPreprocessing: false }, action: { typeName: 'None', raw: '' },
    next: { onTrue: { kind: 'next' }, onFalse: { kind: 'step', uid: 's1', no: 2 } }, baseImage: { state: 'present', url: '/b' },
    raw: { Metadata: { ImageSearchParam: { MaximumNumberToFind: 1, Timeout: 1000, TimeoutEnabled: true }, OcrParamInfo: { MinMatchingValue: 5 } } } }
  const open = (s) => { const st = useEditorStore(); st.skeleton = { steps: [s, { ...base, uid: 's1', no: 2 }], notes: [] }; st.selectedUid = s.uid; return st }

  it('이미지 스텝: 검색 영역·정확도·다중 검사·학습 이미지·동작·흐름·경고 문구', () => {
    open({ ...base, notes: [{ level: 'warning', code: 'UNREACHABLE', params: {} }],
      condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 576, y: 336, w: 846, h: 480 }, image: { accept: 0.85, maxFind: 1, timeout: 1000, timeoutEnabled: true, multi: { count: '1', op: 0 }, trainImages: [{ key: 0, type: true, url: '/t' }] } },
      action: { typeName: 'MouseLeftClick', raw: '24:12', click: { x: 24, y: 12, basis: 'trainImage' } } })
    const text = mount(StepDetail).text()
    for (const v of ['Reset 누르기', 'X 576 · Y 336 · W 846 · H 480', '0.85', '1개 ==', '마우스 클릭', '24:12', 'NEXT', '→2', '3회 · 2초', '1번 스텝에서 출발해 닿지 않는']) expect(text).toContain(v)
  })
  it('조건 종류 탭은 지금 종류만 강조', () => {
    open({ ...base, notes: [], condition: { kind: 'ocr', skipPreprocessing: false, searchArea: null, ocr: { op: 1, opName: 'TextEqual', text: 'IDLE', multi: { count: '1', op: 0 }, raw: 'IDLE@@1-0' } } })
    const tabs = mount(StepDetail).findAll('[data-testid="se-detail-kind"] span')
    expect(tabs.map((x) => x.text())).toEqual(['이미지', 'OCR', '조건 없음', '설비 상태'])
    expect(tabs[1].classes()).toContain('bg-primary-500')
  })
  it('설비 상태·OCR', () => {
    open({ ...base, notes: [], condition: { kind: 'eqpState', skipPreprocessing: null, eqpState: { target: 'B1', targetKind: 'loadport', state: 'RUN', code: '', raw: 'B1,RUN,_' } }, action: { typeName: 'None', raw: '' } })
    let text = mount(StepDetail).text()
    for (const v of ['로드포트', 'B1', 'RUN', 'B1,RUN,_', '해당 없음']) expect(text).toContain(v)
    open({ ...base, notes: [], condition: { kind: 'ocr', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 3, h: 4 }, ocr: { op: 7, opName: 'NumberInRange', text: '', min: 1, max: 5, number: -218, multi: { count: '1', op: 0 }, raw: '@@@@1-0' } }, action: { typeName: 'None', raw: '' } })
    text = mount(StepDetail).text()
    for (const v of ['범위 안', '1 ~ 5', '@@@@1-0']) expect(text).toContain(v)
  })
  it('흐름의 스텝 표시를 누르면 이동', async () => {
    const st = open({ ...base, notes: [], condition: { kind: 'none', skipPreprocessing: false }, action: { typeName: 'None', raw: '' } })
    await mount(StepDetail).find('[data-testid="se-detail-onFalse"]').trigger('click')
    expect(st.selectedUid).toBe('s1')
  })
  it('Metadata 가 없어 해석 못 한 이미지·OCR 스텝: 던지지 않고 안내 줄과 경고를 보인다', () => {
    for (const [kind, op] of [['image', 1], ['ocr', 2]]) {
      open({ ...base, notes: [{ level: 'warning', code: 'PARSE_FAILED', params: { field: 'metadata' } }], condition: { kind, operationRaw: op, skipPreprocessing: null } })
      const text = mount(StepDetail).text()
      expect(text).toContain('저장된 조건 값을 해석하지 못했습니다(경고 참고).')
      expect(text).toContain(MESSAGES.SEW_NOTE_PARSE_FAILED_metadata) // field 별 문구
    }
  })
  it('같은 코드의 경고가 여럿이어도 줄마다 그려지고 키 중복 경고가 없다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const P = { level: 'warning', code: 'PARSE_FAILED', params: { field: 'metadata' } }
    const U = { level: 'warning', code: 'UNREACHABLE', params: {} }
    const st = open({ ...base, notes: [U, P, P] })
    const w = mount(StepDetail)
    expect(w.text().split(MESSAGES.SEW_NOTE_PARSE_FAILED_metadata).length - 1).toBe(2)
    st.skeleton.steps[0].notes = [P, P, U] // 가운데가 바뀌는 갱신 — 키가 겹치면 Vue 가 경고한다
    await w.vm.$nextTick()
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Duplicate keys'))).toEqual([])
    warn.mockRestore()
  })
  it('클릭 지점이 학습 이미지 밖이면 문구에 좌표를 채워 보이고, 표시·마커는 0번 학습 이미지에만', async () => {
    open({ ...base, condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 3, h: 4 }, image: { accept: 0.9, maxFind: 1, timeout: 1000, timeoutEnabled: true, multi: { count: '1', op: 0 }, trainImages: [{ key: 0, type: true, url: '/t' }, { key: 1, type: true, url: '/t2' }] } },
      action: { typeName: 'MouseLeftClick', raw: '240:12', click: { x: 240, y: 12, basis: 'trainImage' } } })
    const w = mount(StepDetail, { global: { stubs: { CropView: true } } })
    expect(w.text().split('+ 클릭').length - 1).toBe(1)
    const marked = w.findAllComponents(CropView).filter((c) => c.props('marker'))
    expect(marked).toHaveLength(1)
    expect(marked[0].props('src')).toBe('/t')
    marked[0].vm.$emit('outside', true)
    await w.vm.$nextTick()
    expect(w.text()).toContain('클릭 지점: 학습 이미지 밖 (240, 12)')
  })
  it('성긴(깨진) 스텝에서도 undefined·NaN·{op} 글자가 화면에 나오지 않는다', () => {
    const sparse = { ...base, isShowDialog: undefined, retry: {}, raw: {}, baseImage: { state: 'absent' } }
    const conditions = [
      { kind: 'unknown', skipPreprocessing: null },
      { kind: 'image', skipPreprocessing: false, searchArea: {}, image: { multi: { count: '1', op: 0 }, trainImages: [{ key: 0, url: '/t' }] } },
      { kind: 'ocr', skipPreprocessing: false, searchArea: { x: 1 }, ocr: { op: 7, opName: 'NumberInRange', multi: { count: '1', op: 0 } } },
      { kind: 'ocr', skipPreprocessing: false, searchArea: null, ocr: { op: 5, opName: 'NumberEqual', multi: { count: '1', op: 0 } } }
    ]
    for (const condition of conditions) {
      open({ ...sparse, condition })
      const w = mount(StepDetail)
      w.find('details').element.open = true
      const text = w.text()
      for (const bad of ['undefined', 'NaN', '{op}']) expect(text, `${condition.kind}/${bad}`).not.toContain(bad)
    }
  })
  it('스텝이 없으면 빈 안내', () => {
    const st = useEditorStore(); st.skeleton = { steps: [], notes: [] }
    expect(mount(StepDetail).text()).toContain('스텝을 고르면')
  })
})
