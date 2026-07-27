import { describe, it, expect, vi, afterEach } from 'vitest'
import { engineStore } from '@/ui/mobx/EngineStore'
import type { Application } from '@/Application'

describe('EngineStore.setScenario(null) — выход в меню', () => {
  afterEach(async () => {
    // Стор — модульный синглтон, поэтому возвращаем `app` в исходное
    // состояние (null), чтобы не протекать в соседние тесты этого файла.
    await engineStore.initialize(null as unknown as Application)
  })

  it('доходит до Application.dispose() и не запускает Application.run()', async () => {
    const app = { dispose: vi.fn(), run: vi.fn() } as unknown as Application

    await engineStore.initialize(app)
    await engineStore.setScenario(null)

    expect(app.dispose).toHaveBeenCalledTimes(1)
    expect(app.run).not.toHaveBeenCalled()
  })
})
