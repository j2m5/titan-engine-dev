import type { GeneratedFile } from '@/core/framework/generation/generateDatabaseFiles'

/**
 * Клиент транспорта записи данных (dev-only).
 *
 * Тонкая обёртка над fetch к эндпоинту dbEditorPlugin. UI вызывает её
 * с результатом generateDatabaseFiles — endpoint и разбор ответа в одном месте.
 *
 * Работает только при запущенном dev-сервере Vite. В production эндпоинта нет
 * (плагин apply:'serve'), поэтому вызов осмыслен лишь в режиме разработки —
 * UI редактора и так доступен только в dev.
 */

export interface SaveResult {
  ok: boolean
  written?: string[]
  error?: string
}

export async function saveDatabaseFiles(
  files: GeneratedFile[],
  route: string = '/__db/save'
): Promise<SaveResult> {
  try {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files })
    })

    const result = (await response.json()) as SaveResult

    if (!response.ok || !result.ok) {
      return { ok: false, error: result.error ?? `HTTP ${response.status}` }
    }

    return result
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
