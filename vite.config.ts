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
    setupFiles: ['./tests/setup.ts'],
    // .env не отслеживается git, поэтому флаги оттуда у каждого свои.
    // Панель статистики в тестах должна быть выключена детерминированно:
    // её конструктор берёт 2D-контекст канваса, которого в jsdom нет.
    env: {
      VITE_SHOW_STATS_PANEL: 'false'
    }
  },
  server: {
    port: 8080,
    strictPort: true
  }
})
