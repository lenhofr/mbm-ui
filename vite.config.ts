import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large AWS/auth deps into their own chunk so the main bundle stays small
          'vendor-amplify': ['aws-amplify', '@aws-amplify/ui-react'],
          'vendor-fuse': ['fuse.js'],
        },
      },
    },
  },
})
