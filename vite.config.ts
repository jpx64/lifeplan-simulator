import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app under /<repo>/
export default defineConfig({
  base: '/lifeplan-simulator/',
  plugins: [react()],
  build: {
    // the chart library is the bulk of the bundle; one file is fine for this app
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
