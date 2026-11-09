// 새 시나리오(P2-D Task 6, 설계 §6.8·§7, 분석 10 §3·13 §4.3, 목업 2026-11-08-new-scenario-v1).
// - 만들 값: 작업본(출처 없음·스텝 0·운영 속성 = 사내 클래스 기본값)과 같은 대상을 담은 뼈대(저장 창이 출처 없는 세션의 기본 대상을 뼈대에서 읽는다).
// - 창 검사: 칸마다 한꺼번에 본다. empty = 아직 채우지 않은 칸(손대기 전에는 빨갛게 하지 않는다 — 목업 "내가 정한 것" 6).
//   이름은 editor/nameRule 하나(규칙이 있으면 대·중분류 + 3·4번 칸만, 없으면 직접 입력 — 40 §2.0 2026-11-09 ②).
// 문구는 돌려주지 않는다 — code 만(issueKey 가 문구 키를 고른다).
import { buildName, checkName } from './nameRule'
import { barFieldErrors } from './fieldRules'
import { LABELS } from '../messages'

export const DEFAULT_TIMEOUT = '240' // 사내 새 시나리오 TimeoutLimit 240(분). 바 칸처럼 문자열(서버 작업본이 문자열을 요구한다)
export const newScenarioId = (process, model, name) => `${process}-${model}-${name}`

// 사내 ScenarioProperty(id) = initDefaultValue + ID(DataStruct/ScenarioProperty.cs:68-103). ScenarioTriggerType 은 사내 창이 늘 USER_DEFINED(0),
// Type 은 고른 값(10 §3.1). Owners 는 배포가 정한다.
export function defaultProperty({ id, type }) {
  return {
    ID: id, Owners: [], ScenarioTriggerType: 0,
    DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: false, DoNotSendEmailWhenFail: false,
    StartDelay: 0, RetryCnt: 0, RetryInterval: 10, NextScenarioIfSuccess: null, NextScenarioIfFail: null,
    Type: type, DetailedDescriptionTitle: '', DetailedDescription: '', DescriptionFromConductor: '', EDMLink: '',
    IsEnabled: true, ExecutingLevel: 0, IsShowDialog: true, Priority: 10, LcncType: 0, LowcodeExtension: ''
  }
}

// → { working, skeleton }. 뼈대에는 edited 를 두지 않는다 — beginSession 이 뼈대에서 출처를 만들지 않게(Task 2b 걱정 4).
// isNew = 서버에 아직 없는 시나리오(바 "아직 저장한 적 없음", 주소 쿼리를 쓰지 않음).
export function newScenarioOf({ process, model, name, type, description, timeoutLimit = DEFAULT_TIMEOUT }) {
  const id = newScenarioId(process, model, name)
  const property = defaultProperty({ id, type })
  const header = { description: String(description ?? ''), timeoutLimit: String(timeoutLimit ?? '') }
  return {
    working: { source: null, headCrtime: null, header, steps: [], property },
    skeleton: {
      process, model, name, id, isNew: true,
      version: { crtime: null, isCurrent: true, fileId: null }, headCrtime: null, propertyRev: null,
      header: { ...header, targetWindow: null }, property, performance: null, steps: [], notes: []
    }
  }
}

// 창의 값 f = { process, model, type, major, middle, part3, part4, name, description, timeoutLimit }, rule = nameRuleOf 결과(없으면 직접 입력)
export const newName = (f, rule) => (rule ? buildName(f).name : f.name ?? '')

const NAME_FIELDS = ['major', 'middle', 'part3', 'part4', 'name']
export function checkNewScenario(f, { rule }) {
  const out = []
  const add = (field, code, params = {}, empty = false) => out.push({ field, code, params, empty })
  if (!f.process) add('process', 'PROCESS_REQUIRED', {}, true)
  if (!f.model) add('model', f.process ? 'MODEL_REQUIRED' : 'PROCESS_FIRST', {}, true)
  if (!f.type) add('type', 'TYPE_REQUIRED', {}, true)
  if (rule) {
    const { errors } = buildName(f)
    for (const k of NAME_FIELDS) {
      const e = errors[k]
      if (e) add(k, e.code, e.params, k === 'major' || k === 'middle' || (k === 'part3' && e.code === 'PART_SHORT' && !f.part3))
    }
  } else {
    const e = checkName(f.name)
    if (e) add('name', e.code, e.params, e.code === 'NAME_EMPTY')
  }
  const bar = barFieldErrors({ description: f.description, timeoutLimit: f.timeoutLimit })
  if (String(f.description ?? '').trim() === '') add('description', 'MAIL_TITLE_EMPTY', {}, true) // 공백뿐이면 빈 값(목업 "내가 정한 것" 16)
  else if (bar.description) add('description', bar.description)
  if (bar.timeoutLimit) add('timeoutLimit', bar.timeoutLimit, {}, String(f.timeoutLimit ?? '') === '')
  return out
}

const NAME_CODES = new Set(['MAJOR_REQUIRED', 'MIDDLE_REQUIRED', 'PART_SHORT', 'PART_CHARS', 'BUILT_TOO_LONG', 'BUILT_CHARS'])
const NEW_CODES = new Set(['PROCESS_REQUIRED', 'MODEL_REQUIRED', 'PROCESS_FIRST', 'TYPE_REQUIRED'])
// 문구 키: 이름 만들기 code = SEW_NAME_(저장 창 이름 만들기와 같은 문구), 이 창의 code = SEW_NEW_, 나머지 = 서버 검사와 같은 RULE_
export const issueKey = (i) => (NAME_CODES.has(i.code) ? `SEW_NAME_${i.code}` : NEW_CODES.has(i.code) ? `SEW_NEW_${i.code}` : `RULE_${i.code}`)

// 분 → "4시간"·"1시간 30분"·"45분"
export function humanMinutes(m) {
  const h = Math.floor(m / 60)
  const r = m % 60
  const { hour, minute } = LABELS.prop
  return [h ? `${h}${hour}` : '', r ? `${r}${minute}` : ''].filter(Boolean).join(' ') || `0${minute}`
}
