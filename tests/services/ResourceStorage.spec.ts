import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from 'vitest'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'

/**
 * jsdom без node-canvas не умеет 2D-контекст (см. tests/textures/
 * PlaceholderTexture.spec.ts — тот же приём). getTextureOrMake на промахе
 * достаёт PlaceholderTexture.get(), которая без стаба canvas.getContext('2d')
 * упадёт на context.fillStyle.
 */
const stubCanvas = (): HTMLCanvasElement =>
  ({
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: '', fillRect: () => undefined })
  }) as unknown as HTMLCanvasElement

describe('ResourceStorage.getTextureOrMake', () => {
  let createElementSpy: MockInstance | null = null

  beforeAll(() => {
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas())
  })

  afterAll(() => {
    createElementSpy?.mockRestore()
  })

  it('два промаха по РАЗНЫМ ключам отдают ОДИН И ТОТ ЖЕ объект', () => {
    // Регрессия на течь: раньше каждый промах порождал новую CanvasTexture
    // 64x64 (ResourceStorage.generateTexture), которую никто не кешировал и не
    // освобождал. Теперь оба промаха обязаны достать один и тот же разделяемый
    // PlaceholderTexture.get().
    const first = resourceStorage.getTextureOrMake('missing-key-a.png')
    const second = resourceStorage.getTextureOrMake('missing-key-b.png')

    expect(first).toBe(second)
    expect(first).toBe(PlaceholderTexture.get())
  })

  it('существующий ключ возвращает зарегистрированную текстуру, а не заглушку', () => {
    const texture = PlaceholderTexture.get()

    // Собственная лёгкая текстура вместо PlaceholderTexture.get(), чтобы не
    // спутать «нашли по ключу» с «упали на заглушку», которая тоже могла бы
    // случайно совпасть.
    const registered = texture.clone()
    registered.name = 'registered-key.png'
    resourceStorage.addTexture(registered)

    try {
      expect(resourceStorage.getTextureOrMake('registered-key.png')).toBe(registered)
    } finally {
      resourceStorage.deleteTexture('registered-key.png')
    }
  })
})
