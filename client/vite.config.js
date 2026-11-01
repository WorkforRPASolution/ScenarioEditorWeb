import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.js'],
    // e2e/는 Playwright 전용 (npx playwright test) — vitest 수집 제외
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**']
  }
})
