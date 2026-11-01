<script setup>
// shell-modified: WebManager@2f1eb0a client/src/layouts/Header.vue — 공지·알림·도움말 버튼과 로그아웃을 뺐다(로그인 없음).
// 로고·메가 메뉴·테마 토글 마크업은 원본 그대로다.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMenuStore } from '../shared/stores/menu'
import { useAuthStore } from '../shared/stores/auth'
import { useTheme } from '../shared/composables/useTheme'
import AppIcon from '../shared/components/AppIcon.vue'

const router = useRouter()
const menuStore = useMenuStore()
const authStore = useAuthStore()
const { isDark, toggleTheme } = useTheme()

const userInitial = computed(() => {
  const name = authStore.user?.name || 'U'
  return name.charAt(0).toUpperCase()
})

const userName = computed(() => authStore.user?.name || 'User')
const userSingleId = computed(() => authStore.user?.singleid || '')

const handleSubMenuClick = (subMenu, mainMenuId) => {
  menuStore.setActiveMainMenu(mainMenuId)
  menuStore.closeMegaMenu()
  router.push(subMenu.path)
}
</script>

<template>
  <header class="h-14 bg-primary-500 flex items-center px-4 shrink-0 shadow-md z-50">
    <!-- Logo -->
    <div class="flex items-center gap-3">
      <div class="w-8 h-8 rounded flex items-center justify-center">
        <svg class="w-7 h-7" viewBox="0 0 100 100">
          <g opacity="0.9"><polygon points="5,70 50,54 95,70 50,86" fill="#b4c8dc"/><polygon points="5,70 50,86 50,92 5,76" fill="#8aa0b8"/><polygon points="50,86 95,70 95,76 50,92" fill="#9eb4cc"/></g>
          <g opacity="0.85"><polygon points="5,48 50,32 95,48 50,64" fill="#48b0a8"/><polygon points="5,48 50,64 50,70 5,54" fill="#2c908a"/><polygon points="50,64 95,48 95,54 50,70" fill="#3aa09a"/></g>
          <g opacity="0.82"><polygon points="5,26 50,10 95,26 50,42" fill="#5c9ee0"/><polygon points="5,26 50,42 50,48 5,32" fill="#3878c0"/><polygon points="50,42 95,26 95,32 50,48" fill="#4a8cd0"/></g>
        </svg>
      </div>
      <span class="text-white font-bold text-lg tracking-tight">WebManager</span>
    </div>

    <!-- Main Menu Navigation -->
    <nav class="ml-8 flex h-full">
      <div
        v-for="menu in menuStore.menuItems"
        :key="menu.id"
        class="relative group flex items-center h-full"
      >
        <button
          class="flex items-center gap-1 px-4 h-full text-white/90 hover:text-white hover:bg-white/10 font-medium transition-colors"
          :class="{ 'bg-white/10 text-white': menuStore.activeMainMenu === menu.id }"
          @click="menuStore.setActiveMainMenu(menu.id)"
        >
          {{ menu.label }}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        <!-- Mega Menu Dropdown -->
        <div class="hidden group-hover:block absolute top-14 left-0 min-w-[280px] bg-white dark:bg-dark-card shadow-xl border border-gray-200 dark:border-dark-border rounded-b-lg overflow-hidden">
          <div class="p-4">
            <h3 class="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              {{ menu.label }}
            </h3>
            <ul class="space-y-1">
              <li v-for="subMenu in menu.subMenus" :key="subMenu.id">
                <button
                  @click="handleSubMenuClick(subMenu, menu.id)"
                  class="w-full text-left px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-2"
                >
                  <AppIcon :name="subMenu.icon" size="4" class="text-gray-400" />
                  <span class="font-medium">{{ subMenu.label }}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </nav>

    <!-- Right Side: Theme Toggle, Notifications, User -->
    <div class="ml-auto flex items-center gap-2">
      <!-- Theme Toggle -->
      <button
        @click="toggleTheme"
        class="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
      >
        <svg v-if="isDark" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
        </svg>
        <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>
        </svg>
      </button>

      <!-- User Menu (로그인 없음: 설정 사용자 표시만) -->
      <div class="relative group">
        <button class="flex items-center gap-2 p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
          <div class="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center">
            <span class="text-sm font-medium">{{ userInitial }}</span>
          </div>
        </button>
        <div class="hidden group-hover:block absolute top-full right-0 mt-1 w-56 bg-white dark:bg-dark-card shadow-xl border border-gray-200 dark:border-dark-border rounded-lg overflow-hidden">
          <div class="p-3">
            <p class="font-medium text-gray-900 dark:text-white text-sm">{{ userName }}</p>
            <p v-if="userSingleId" class="text-xs text-gray-500 dark:text-gray-400">{{ userSingleId }}</p>
            <div class="mt-1 flex items-center gap-1">
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-400">
                {{ authStore.roleName }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>
