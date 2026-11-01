// WebManager TemplateGrid.vue:54-83 기준값(지도 §2.4). 공용 모듈이 없어 기능 안에 하나 둔다(지도 §2.7).
import { computed } from 'vue'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import { useTheme } from '@/shared/composables/useTheme'

let registered = false
export function registerGrid() {
  if (registered) return
  ModuleRegistry.registerModules([AllCommunityModule])
  registered = true
}

const common = { fontSize: 12, spacing: 6, rowHeight: 36, headerHeight: 40, borderRadius: 0, wrapperBorderRadius: 0 }
const lightTheme = themeQuartz.withParams({ ...common, backgroundColor: '#ffffff', headerBackgroundColor: '#f8fafc', borderColor: '#e2e8f0', foregroundColor: '#1e293b' })
const darkTheme = themeQuartz.withParams({ ...common, backgroundColor: '#1e293b', headerBackgroundColor: '#0f172a', borderColor: '#334155', foregroundColor: '#e2e8f0',
  oddRowBackgroundColor: '#1e293b', rowHoverColor: '#334155', selectedRowBackgroundColor: 'rgba(59, 130, 246, 0.2)' })

export function useGridTheme() {
  const { isDark } = useTheme()
  return computed(() => (isDark.value ? darkTheme : lightTheme))
}
