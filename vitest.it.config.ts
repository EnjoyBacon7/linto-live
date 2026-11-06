import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.it.test.ts'],
    passWithNoTests: true
  }
})
