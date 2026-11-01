import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./csharp-golden/globalSetup.js']
  }
})
