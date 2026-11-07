// 작업본(EditedStep) → P1 뼈대 스텝 모양. 표·순서도·큰 화면·상세가 모두 store.steps 하나를 읽으므로 여기서만 바꾼다.
// - 고친 것이 없으면(작업본 스텝 배열 = 저장 기준점) 뼈대 스텝 배열 그대로(P1 과 같음).
// - 손대지 않은 스텝(저장 기준점의 같은 uid 스텝과 같은 객체)은 뼈대 스텝(raw·notes·URL)을 쓰고 번호만 위치에서 다시 센다.
// - 고치거나 새로 만든 스텝은 고친 값으로 만든다. 그림 URL 은 images 참조에서 만든다(붙여넣은 스텝의 trainImages[].url 은 낡을 수 있다), raw 는 없다.
// - 알림(R-T5c): 스텝을 바꾸면 서버가 저장된 순서로 계산한 흐름 알림(GRAPH_NOTE_CODES)은 낡으므로 손대지 않은 스텝에서 빼고,
//   모든 줄에 checkStepFields 의 갈 곳 결과(LAST_STEP_NEXT·NEXT_SELF·NEXT_UNRESOLVED)를 경고로 붙인다. 고친·새 스텝은 서버 알림 대신
//   칸 오류(error) 전부를 경고로 보인다. UNREACHABLE·NO_SUCCESS 는 다시 계산하지 않는다(저장 창의 서버 /check 가 보인다).
import { imageUrl } from '../api'
import { refUrl } from './images'
import { checkStepFields } from './fieldRules'

const GRAPH_NOTE_CODES = new Set(['LAST_STEP_NEXT', 'NEXT_SELF', 'NEXT_OUT_OF_RANGE', 'NEXT_UNRESOLVED', 'UNREACHABLE'])
const REF_CODES = new Set(['LAST_STEP_NEXT', 'NEXT_SELF', 'NEXT_UNRESOLVED'])
// checkStepFields 결과 → 경고 알림(코드마다 하나). fields 를 주면 그 칸만.
function liveNotes(errs, fields = null) {
  const out = []
  const seen = new Set()
  for (const [field, e] of Object.entries(errs)) {
    if (e.level !== 'error' || seen.has(e.code)) continue
    if (fields && !(fields.includes(field) && REF_CODES.has(e.code))) continue
    seen.add(e.code)
    out.push({ level: 'warning', code: e.code, params: e.params ?? {} })
  }
  return out
}

// 사내 ScriptType 순서(server domain/enums.js SCRIPT_TYPE_NAMES)
const SCRIPT_TYPE_NAMES = ['None', 'MouseLeftClick', 'MouseLeftDoubleClick', 'MouseRightClick', 'MouseMove', 'Keyboard', 'Wait', 'Variable',
  'OICommand', 'FindWindow', 'SendEmail', 'RunCommand', 'CustomScript', 'FAP', 'ACS', 'NativeFunction']
const typeNameOf = (t) => (Number.isInteger(t) && t >= 0 && t < SCRIPT_TYPE_NAMES.length ? SCRIPT_TYPE_NAMES[t] : null)
const needsBaseImage = (kind) => kind === 'image' || kind === 'ocr'
const isRef = (r) => !!r && typeof r === 'object' && 'from' in r

// 그림 표시 URL: 편집으로 만든 스텝은 src(브라우저 URL), 뼈대 스텝은 url(API 경로).
export const imageSrc = (img) => img?.src ?? (img?.url ? imageUrl(img.url) : null)

function retarget(t, pos) {
  if (t?.kind !== 'step') return t
  const n = pos.get(t.uid)
  if (!n) return { kind: 'unresolved' }
  return t.no === n ? t : { kind: 'step', uid: t.uid, no: n }
}

function fromSkeleton(sk, no, pos, live) {
  const onTrue = retarget(sk.next.onTrue, pos)
  const onFalse = retarget(sk.next.onFalse, pos)
  const kept = sk.notes.filter((n) => !GRAPH_NOTE_CODES.has(n.code))
  const notes = kept.length === sk.notes.length && !live.length ? sk.notes : [...kept, ...live]
  if (sk.no === no && onTrue === sk.next.onTrue && onFalse === sk.next.onFalse && notes === sk.notes) return sk
  return { ...sk, no, next: { onTrue, onFalse }, notes }
}

// 찾을 그림: trainImages(뼈대에서 온 키·Type)와 images.train(참조) 키를 합친다 — 다시 잡은 그림은 images.train 에만 있다. URL 은 참조에서.
function trainImagesOf(image, train, ctx) {
  const listed = Array.isArray(image.trainImages) ? image.trainImages : []
  const have = new Set(listed.map((ti) => String(ti.key)))
  const extra = Object.keys(train).filter((k) => !have.has(k)).sort((a, b) => Number(a) - Number(b)).map((k) => ({ key: Number(k), type: null }))
  return [...listed, ...extra].map((ti) => ({ ...ti, url: null, src: refUrl(train[String(ti.key)], ctx) }))
}

function fromEdited(st, no, pos, ctx, notes) {
  const c = st.condition || {}
  const images = st.images || { train: {}, base: null }
  let condition = c
  if (c.kind === 'image' && c.image) condition = { ...c, image: { ...c.image, trainImages: trainImagesOf(c.image, images.train || {}, ctx) } }
  let baseImage = { state: 'notNeeded' }
  if (needsBaseImage(c.kind)) {
    const src = isRef(images.base) ? refUrl(images.base, ctx) : null
    baseImage = src ? { state: 'present', src } : { state: 'missing' }
  }
  const action = st.action || {}
  return {
    uid: st.uid, no, condition,
    action: { ...action, typeName: typeNameOf(action.type) ?? action.typeName ?? null },
    next: { onTrue: retarget(st.next?.onTrue, pos), onFalse: retarget(st.next?.onFalse, pos) },
    retry: st.retry, descriptionToEmail: st.descriptionToEmail, descriptionToDialog: st.descriptionToDialog, isShowDialog: st.isShowDialog,
    baseImage, notes
  }
}

// user = 내 정보(재시도 상한이 관리 등급을 따른다).
export function displaySteps(session, skeleton, { uploads, draftId, user } = {}) {
  const working = session?.working
  const skSteps = skeleton?.steps ?? []
  if (!working) return skSteps
  const base = session.saveBase
  if (base && working.steps === base.steps) return skSteps
  const pos = new Map(working.steps.map((s, i) => [s.uid, i + 1]))
  const baseByUid = new Map((base?.steps ?? []).map((s) => [s.uid, s]))
  const skByUid = new Map(skSteps.map((s) => [s.uid, s]))
  const ctx = { session, uploads, draftId }
  return working.steps.map((st, i) => {
    const sk = skByUid.get(st.uid)
    const base = baseByUid.get(st.uid)
    const errs = checkStepFields(st, { working, isNew: false, base, user })
    if (sk && base === st) return fromSkeleton(sk, i + 1, pos, liveNotes(errs, ['onTrue', 'onFalse']))
    return fromEdited(st, i + 1, pos, ctx, liveNotes(errs))
  })
}
