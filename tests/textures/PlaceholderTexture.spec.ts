import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from 'vitest'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'
import { resourceStorage } from '@/core/services/ResourceStorage'

/**
 * jsdom без node-canvas не умеет 2D-контекст (см. tests/asteroidDensity/
 * RingAlphaReadback.spec.ts — тот же приём). Без стаба canvas.getContext('2d')
 * вернёт null и PlaceholderTexture.generate() упадёт на context.fillStyle.
 */
const stubCanvas = (): HTMLCanvasElement =>
  ({
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: '', fillRect: () => undefined })
  }) as unknown as HTMLCanvasElement

describe('PlaceholderTexture', () => {
  let createElementSpy: MockInstance | null = null

  beforeAll(() => {
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas())
  })

  afterAll(() => {
    createElementSpy?.mockRestore()
  })

  it('повторные обращения дают ОДИН И ТОТ ЖЕ объект', () => {
    // Регрессия на течь getTextureOrMake: там каждый промах создавал новую
    // CanvasTexture 64x64, которую никто не освобождал.
    expect(PlaceholderTexture.get()).toBe(PlaceholderTexture.get())
  })

  it('не регистрируется в реестре ресурсов', () => {
    // Счёт до/после порядко-зависим: синглтон переживает все тесты файла, и к
    // моменту этого теста регистрация (если бы она была) уже могла случиться
    // в предыдущем тесте — дельта осталась бы нулевой, даже если бы заглушка
    // регистрировалась. Поэтому проверяем факт напрямую — по ссылке, а не по счёту.
    const placeholder = PlaceholderTexture.get()

    expect(resourceStorage.textures.contains((texture) => texture === placeholder)).toBe(false)
  })

  it('переживает разборку сцены и остаётся пригодной', () => {
    // Инвариант владения: заглушка — ресурс уровня приложения. Попади она под
    // deleteAllTextures(), все материалы после первого же переключения сценария
    // смотрели бы на освобождённую текстуру. `.image` для этого не индикатор:
    // three.js Texture.dispose() не обнуляет `.image`, это просто событие для
    // рендерера — объект остаётся годным что после диспоуза, что без него.
    // Проверяем поэтому напрямую: dispose() заглушки не должен быть вызван.
    const placeholder = PlaceholderTexture.get()
    const disposeSpy = vi.spyOn(placeholder, 'dispose')

    resourceStorage.deleteAllTextures()

    expect(disposeSpy).not.toHaveBeenCalled()

    disposeSpy.mockRestore()
  })
})
