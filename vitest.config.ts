import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Always use the LocalAdapter in tests, even when .env.local points at the deployed API
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('') },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
})
