/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@storage': path.resolve(__dirname, './storage')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './tests/setup.ts'
  },
  server: {
    port: 8080,
    strictPort: true
  }
})
