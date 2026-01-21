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
      '@public': path.resolve(__dirname, './public'),
      '@storage': path.resolve(__dirname, './storage'),
      '@titanui': path.resolve(__dirname, './src/ui/TitanUI')
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
