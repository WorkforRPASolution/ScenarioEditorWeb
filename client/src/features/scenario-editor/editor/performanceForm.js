// 성과 입력 창의 작업본(form) ↔ 서버 값(설계 §7). 순수 함수만.
// 서버 값 = performanceFromBson 모양(camelCase), 보내는 값 = BSON 키(사내 C# 이름). EqpPerfornmanceLoss 는 칸이 없고 보내지 않는다.
import { EFFECT_KEYS, isIntText } from './performanceRules'

// 창이 보낼 수 있는 성과 칸(서버 performanceService INPUT_KEYS). 순서 = 화면에 보이는 바뀐 칸 순서.
const FIELD_KEYS = ['PerformType', 'Group', 'Grade', 'SupervisorComment', 'ScenarioDescription', 'Trigger', 'TriggerInfo',
  ...EFFECT_KEYS, 'AccidentType', 'AccidentInfo', 'AdditionalEffect']

// 저장된 성과 → BSON 키 값(완료 판정·바뀐 칸 비교). 성과가 없거나 칸이 없으면 서버가 읽은 대로 빈 값(SE-032 — 화면 문구를 값으로 쓰지 않는다).
export function savedFields(view) {
  const v = view ?? {}
  return {
    PerformType: v.performType ?? 0, Group: v.group ?? '', Grade: v.grade ?? 0, SupervisorComment: v.supervisorComment ?? '',
    ScenarioDescription: v.scenarioDescription ?? '', Trigger: v.trigger ?? 0, TriggerInfo: v.triggerInfo ?? null,
    ManWorkLoss: v.manWorkLoss ?? 0, EqpStopLoss: v.eqpStopLoss ?? 0, WaferLoss: v.waferLoss ?? 0, InvestCostLoss: v.investCostLoss ?? 0,
    AccidentType: v.accidentType ?? 0, AccidentInfo: v.accidentInfo ?? '', AdditionalEffect: v.additionalEffect ?? ''
  }
}

// 저장된 성과 → 작업본. 효과 유형 None(그 밖)은 Active 를 골라 둔다(사내 :270). 효과는 체크 + 값 글(0 이면 꺼짐).
export function formOf(view) {
  const s = savedFields(view)
  const eff = (n) => ({ on: n !== 0, v: n !== 0 ? String(n) : '' })
  return {
    type: s.PerformType === 2 ? 2 : 1,
    group: s.Group,
    grade: s.Grade,
    comment: s.SupervisorComment,
    desc: s.ScenarioDescription,
    trig: s.Trigger,
    trigInfo: s.TriggerInfo ?? '',
    eff: Object.fromEntries(EFFECT_KEYS.map((k) => [k, eff(s[k])])),
    acc: s.AccidentType,
    accInfo: s.AccidentInfo,
    add: s.AdditionalEffect,
    devs: (view?.citizenDevelopers ?? []).map((d) => ({ id: d.knoxId, name: d.name, sdwt: d.sdwt, p: String(d.contribution) }))
  }
}

// 체크를 끈 효과는 0, 체크한 칸의 글이 정수가 아니면 NaN(검사가 막는다)
const effectValue = (e) => (!e.on ? 0 : isIntText(e.v) ? Number(String(e.v).trim()) : NaN)

// 작업본 → 보낼 수 있는 값(BSON 키). Passive 에서 Active 로 바꾸면 그룹은 빈 값(사내 :346), 이미 Active 인 성과의 남은 그룹은 건드리지 않는다.
// 사고 정보는 Key(DC-139) — 사고 유형을 바꾸면 화면이 비운다.
export function payloadOf(f, saved) {
  const out = {
    PerformType: f.type,
    Group: f.type === 2 ? f.group : saved.PerformType === 1 ? saved.Group : '',
    Grade: f.grade,
    SupervisorComment: f.comment,
    ScenarioDescription: f.desc,
    Trigger: f.trig,
    TriggerInfo: f.trigInfo,
    AccidentType: f.acc,
    AccidentInfo: f.accInfo,
    AdditionalEffect: f.add
  }
  for (const k of EFFECT_KEYS) out[k] = effectValue(f.eff[k])
  return out
}

const norm = (v) => (v === null || v === undefined ? '' : v)
const differs = (a, b) => String(norm(a)) !== String(norm(b))

// 서버에 보낼 칸 = 저장된 값과 다른 칸(설계 §7 "바꾼 필드만 $set"). 트리거 정보 null 과 빈 글은 같다.
export function sentFields(f, saved) {
  const p = payloadOf(f, saved)
  return Object.fromEntries(FIELD_KEYS.filter((k) => differs(p[k], saved[k])).map((k) => [k, p[k]]))
}

const devsKey = (devs) => JSON.stringify(devs.map((d) => [d.id, String(d.p).trim()]))
export const devsChanged = (init, f) => devsKey(init.devs) !== devsKey(f.devs)

// 사용자가 창을 연 뒤 바꾼 것(바닥 줄 "N개 바뀜"·닫기 확인). 값을 보일 수 있는 칸은 from·to.
export function changesOf(init, f, saved) {
  const a = payloadOf(init, saved)
  const b = payloadOf(f, saved)
  const out = FIELD_KEYS.filter((k) => differs(a[k], b[k])).map((k) => ({ key: k, from: a[k], to: b[k] }))
  if (devsChanged(init, f)) out.push({ key: 'CitizenDeveloper' })
  return out
}

// 원개발자 목록 → 요청 원소. Name·Sdwt 는 서버가 사용자 정보로 채운다(DC-141).
export const citizenDevelopersOf = (f) => f.devs.map((d) => ({ KnoxId: d.id, Contribution: Number(String(d.p).trim()) }))

// Sdwt 는 사용자 process 에 ':' 가 있을 때 앞부분(사내 규칙 DC-141) — 찾아 넣은 사람의 표시용
export const sdwtOf = (process) => (typeof process === 'string' && process.includes(':') ? process.split(':')[0] : '')
