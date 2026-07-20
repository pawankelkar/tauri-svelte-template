import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
  },
  resolve: {
    // Without this, `svelte` resolves to its server build and `mount()` throws
    // lifecycle_function_unavailable — component tests need the client build.
    conditions: ['browser'],
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
    },
  },
})
