import { defineConfig } from 'vitest/config'

// 로컬 OrbStack Mongo·Redis 와 SEW 시험 데이터가 있어야 한다(npm run seed -- reset basic anomaly).
export default defineConfig({
  test: { include: ['**/*.int.test.js'], testTimeout: 180_000, hookTimeout: 180_000, fileParallelism: false }
})
