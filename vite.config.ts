/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as path from 'path'
import { dbEditorPlugin } from './vite/dbEditorPlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dbEditorPlugin({ writableRoot: 'storage/database' })],
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
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts']
  },
  server: {
    port: 8080,
    strictPort: true,
    watch: {
      ignored: ['**/storage/database/**']
    }
  }
})
