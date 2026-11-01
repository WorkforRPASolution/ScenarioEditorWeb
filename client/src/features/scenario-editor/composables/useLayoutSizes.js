import { reactive } from 'vue'
import { safeStorage } from './useSafeStorage'

export const LAYOUT_DEFAULTS = { lw: 250, rw: 370, sh: 250 }
const LIMITS = { lw: [180, 460], rw: [300, 620], sh: [120, 2000] }
const KEY = 'se-layout'

function readSaved() {
  try {
    const v = JSON.parse(safeStorage.get(KEY) || '{}')
    const out = {}
    for (const k of Object.keys(LAYOUT_DEFAULTS)) if (Number.isFinite(v[k])) out[k] = v[k]
    return out
  } catch {
    return {}
  }
}

export function useLayoutSizes() {
  const sizes = reactive({ ...LAYOUT_DEFAULTS, ...readSaved() })
  const save = () => safeStorage.set(KEY, JSON.stringify({ ...sizes }))
  const clamp = (k, v) => Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], Math.round(v)))

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
