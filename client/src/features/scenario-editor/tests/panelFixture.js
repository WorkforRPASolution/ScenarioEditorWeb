// 오른쪽 편집 패널 시험용 작업본·뼈대(파일 이름이 .test.js 가 아니라 vitest 가 따로 돌리지 않는다).
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'

const common = (i) => ({
  uid: `s${i}`, origin: i,
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  retry: { limit: 2, intervalMs: 2000 }, descriptionToEmail: `스텝${i}`, descriptionToDialog: '', isShowDialog: true
})

export const imageStep = (i, over = {}) => ({
  ...common(i),
  condition: {
    kind: 'image', operationRaw: 1, skipPreprocessing: false, searchArea: { x: 10, y: 20, w: 300, h: 200 },
    image: { accept: 0.9, maxFind: 1, timeoutEnabled: true, timeout: 1000, trainImages: [{ key: 0, type: true }], multi: { count: '1', op: 0, raw: '1-0' } }
  },
  action: { type: 1, typeName: 'MouseLeftClick', raw: '24:12', click: { x: 24, y: 12, basis: 'trainImage' } },
  images: { train: { 0: { from: 'source', id: `s${i}-train-0` } }, base: { from: 'source', id: `s${i}-bi` } },
  ...over
})

export const ocrStep = (i, over = {}) => ({
  ...common(i),
  condition: {
    kind: 'ocr', operationRaw: 2, skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 30, h: 10 },
    ocr: { op: 1, opName: 'TextEqual', type: 1, text: 'IDLE', number: 0, min: 0, max: 0, minMatching: 0, multi: { count: '1', op: 0, raw: '1-0' }, raw: 'IDLE@@@@1-0' }
  },
  action: { type: 0, typeName: 'None', raw: '' },
  images: { train: {}, base: { from: 'source', id: `s${i}-bi` } },
  ...over
})

export const noneStep = (i, over = {}) => ({
  ...common(i),
  condition: { kind: 'none', operationRaw: 0, skipPreprocessing: false },
  action: { type: 11, typeName: 'RunCommand', raw: 'restart.bat', command: 'restart.bat' },
  images: { train: {}, base: { literal: 'AA==' } },
  ...over
})

export const eqpStep = (i, over = {}) => ({
  ...common(i),
  condition: { kind: 'eqpState', operationRaw: 4, skipPreprocessing: null, eqpState: { target: 'MAIN', targetKind: 'main', state: 'RUN', code: '', raw: 'MAIN,RUN,_' } },
  action: { type: 0, typeName: 'None', raw: '' },
  images: { train: {}, base: { literal: 'AA==' } },
  ...over
})

// 뼈대 스텝(P1 모양): 같은 uid, 번호, 서버 알림, 저장된 raw(찾을 그림 표 포함).
const skNext = (t, steps) => (t?.kind === 'step' ? { ...t, no: steps.findIndex((s) => s.uid === t.uid) + 1 } : t)
const skStepOf = (s, i, steps, over = {}) => ({
  ...s, no: i + 1, notes: [], baseImage: { state: 'present', url: `/u/${s.uid}` },
  next: { onTrue: skNext(s.next.onTrue, steps), onFalse: skNext(s.next.onFalse, steps) },
  raw: { Script: { Type: s.action.type, Value: s.action.raw }, Metadata: { ImageSearchParam: { MaximumNumberToFind: 1, TrainImageMap: s.condition.kind === 'image' ? { 0: { BinaryImage: '/x', Type: true } } : {} } } },
  ...(over[s.uid] || {})
})

// skOver: { [uid]: 뼈대 스텝에 덮어쓸 값 } (알림·raw)
export function panelFixture(steps, { canWrite = true, isCurrent = true, skOver = {}, me = {} } = {}) {
  const edited = { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' }, headCrtime: 1, header: { description: '', timeoutLimit: '1' }, steps, property: {} }
  const skeleton = {
    process: 'P', model: 'M', name: 'N', headCrtime: 1, version: { crtime: 1, isCurrent, fileId: 'F' }, notes: [],
    steps: steps.map((s, i) => skStepOf(s, i, steps, skOver)), edited
  }
  const s = useEditorStore()
  s.me = { singleid: 'u', canWrite, authorityManager: 3, ...me }
  s.skeleton = skeleton
  const e = useEditStore()
  e.begin(skeleton, s.me)
  if (steps.length) s.select(steps[0].uid)
  return { s, e, edited, skeleton }
}
