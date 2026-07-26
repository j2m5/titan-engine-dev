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
    /**
     * `.env` не отслеживается git, поэтому значения оттуда у каждого свои, и
     * прогон, зависящий от них, воспроизводится по-разному на разных машинах.
     * Здесь закреплены все пять переменных, которые читает `src/config`:
     * `VITE_SHOW_STATS_PANEL` (панель статистики берёт 2D-контекст канваса,
     * которого в jsdom нет) и четыре остальных — `VITE_APP_NAME`,
     * `VITE_FS_DRIVER`, `VITE_FILE_BUCKET`, `VITE_S3_URL`. Последние сейчас ни
     * в одном тесте не проверяются, но `VITE_FS_DRIVER` читается в
     * `ResourceManager` при конструировании, то есть уже лежит на пути резолва.
     * Значения намеренно нерабочие: если тест начнёт зависеть от реального
     * хранилища, это станет видно сразу, а не превратится в тихий сетевой вызов.
     */
    env: {
      VITE_SHOW_STATS_PANEL: 'false',
      VITE_APP_NAME: 'Titan Engine (test)',
      VITE_FS_DRIVER: 'local',
      VITE_FILE_BUCKET: 'test-bucket',
      VITE_S3_URL: 'https://s3.invalid'
    }
  },
  server: {
    port: 8080,
    strictPort: true
  }
})
