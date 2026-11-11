import { reactive } from 'vue'
import { safeStorage } from './useSafeStorage'

export const LAYOUT_DEFAULTS = { lw: 250, rw: 370, sh: 250 }
const MIN = { lw: 180, rw: 300, sh: 120 }
const MAX = { lw: 460, rw: 620, sh: 2000 }
const KEY = 'se-layout'

// 위쪽 한계는 화면 크기를 따른다 — 키 큰 모니터에서 저장한 값이 작은 화면에서 경계선을 화면 밖으로 밀어내지 않게.
function upper(k) {
  if (k === 'sh') return Math.min(MAX.sh, window.innerHeight - 260)
  if (k === 'rw') return Math.min(MAX.rw, window.innerWidth - 400)
  if (k === 'lw') return Math.min(MAX.lw, window.innerWidth - 1100) // 스냅샷 패널을 펼쳐도 가운데·오른쪽이 남게
  return MAX[k]
}
const clamp = (k, v) => Math.max(MIN[k], Math.min(Math.max(MIN[k], upper(k)), Math.round(v)))

function readSaved() {
  try {
    const v = JSON.parse(safeStorage.get(KEY) || '{}')
    const out = {}
    for (const k of Object.keys(LAYOUT_DEFAULTS)) if (Number.isFinite(v[k])) out[k] = clamp(k, v[k])
    return out
  } catch {
    return {}
  }
}

export function useLayoutSizes() {
  const sizes = reactive({ ...LAYOUT_DEFAULTS, ...readSaved() })
  const save = () => safeStorage.set(KEY, JSON.stringify({ ...sizes }))

  function startDrag(key, event, sign = 1, axis = 'x') {
    event.preventDefault?.()
    const start = axis === 'x' ? event.clientX : event.clientY
    const from = sizes[key]
    const move = (e) => { sizes[key] = clamp(key, from + sign * ((axis === 'x' ? e.clientX : e.clientY) - start)) }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      save()
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function reset(key) {
    sizes[key] = LAYOUT_DEFAULTS[key]
    save()
  }

  return { sizes, startDrag, reset }
}
