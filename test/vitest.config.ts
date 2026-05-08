import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['client/src/**/*.ts', 'server/src/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/node_modules/**', '**/test/**', '**/*.d.ts'],
      reporter: ['text', 'lcov', 'html'],
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
  resolve: {
    alias: [
      {
        find: /^@engine\/(.*)$/,
        replacement: path.resolve(__dirname, '../client/src/engine/$1'),
      },
    ],
  },
})

