// 작업본(EditedStep) → P1 뼈대 스텝 모양. 표·순서도·큰 화면·상세가 모두 store.steps 하나를 읽으므로 여기서만 바꾼다.
// - 손대지 않은 스텝(저장 기준점의 같은 uid 스텝과 같은 객체)은 뼈대 스텝(raw·notes·URL)을 그대로 쓰고 번호만 위치에서 다시 센다.
// - 고치거나 새로 만든 스텝은 고친 값으로 만든다. notes 는 저장된 값에 대해 서버가 단 것이라 비우고(칸 오류는 checkStepFields 몫),
//   그림 URL 은 images 참조에서 만든다(붙여넣은 스텝의 trainImages[].url 은 낡을 수 있다), raw 는 없다.
import { imageUrl } from '../api'
import { refUrl } from './images'

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

function fromSkeleton(sk, no, pos) {
  const onTrue = retarget(sk.next.onTrue, pos)
  const onFalse = retarget(sk.next.onFalse, pos)
  if (sk.no === no && onTrue === sk.next.onTrue && onFalse === sk.next.onFalse) return sk
  return { ...sk, no, next: { onTrue, onFalse } }
}

function fromEdited(st, no, pos, ctx) {
  const c = st.condition || {}
  const images = st.images || { train: {}, base: null }
  let condition = c
  if (c.kind === 'image' && c.image) {
    const train = images.train || {}
    const list = Array.isArray(c.image.trainImages) ? c.image.trainImages : Object.keys(train).map((k) => ({ key: Number(k), type: null }))
    condition = { ...c, image: { ...c.image, trainImages: list.map((ti) => ({ ...ti, url: null, src: refUrl(train[String(ti.key)], ctx) })) } }
  }
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
    baseImage, notes: []
  }
}

export function displaySteps(session, skeleton, { uploads, draftId } = {}) {
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
    if (sk && baseByUid.get(st.uid) === st) return fromSkeleton(sk, i + 1, pos)
    return fromEdited(st, i + 1, pos, ctx)
  })
}
