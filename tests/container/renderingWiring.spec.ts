import { describe, it, expect } from 'vitest'
import { Kernel } from '@/core/framework/container/Kernel'
import { Container } from '@/core/framework/container/Container'
import { RenderingServiceProvider } from '@/core/providers/RenderingServiceProvider'
import { Tokens } from '@/core/providers/tokens'
import { threeJS } from '@/core/graphic/ThreeJS'

describe('RenderingServiceProvider — проводка рендер-токенов', () => {
  it('регистрирует все шесть токенов рендер-слоя', () => {
    const container: Container = new Kernel([RenderingServiceProvider]).bootstrap()

    expect(container.has(Tokens.Renderer)).toBe(true)
    expect(container.has(Tokens.LabelRenderer)).toBe(true)
    expect(container.has(Tokens.Scene)).toBe(true)
    expect(container.has(Tokens.Camera)).toBe(true)
    expect(container.has(Tokens.AstroControls)).toBe(true)
    expect(container.has(Tokens.Clock)).toBe(true)
  })

  it('регистрация не создаёт объекты — bootstrap не трогает WebGL', () => {
    // Если бы провайдер резолвил Renderer в register()/boot(), в jsdom это упало бы.
    expect(() => new Kernel([RenderingServiceProvider]).bootstrap()).not.toThrow()
  })

  // ВАЖНО: `threeJS` здесь — мок из tests/setup.ts (`vi.mock('@/core/graphic/ThreeJS', ...)`),
  // резолв через instance() ничего не строит, поэтому get() безопасен под jsdom.
  // Когда задача 8 переведёт провайдер на ленивые singleton(() => create...), get(Tokens.Renderer)
  // начнёт реально вызывать createRenderer и потребует WebGL-контекст — этот тест придётся
  // переписать (замокать фабрики или сузить проверку до has() для Renderer/LabelRenderer).
  it('каждый токен указывает на соответствующее поле рендер-слоя', () => {
    const container: Container = new Kernel([RenderingServiceProvider]).bootstrap()

    expect(container.get(Tokens.Renderer)).toBe(threeJS.renderer)
    expect(container.get(Tokens.LabelRenderer)).toBe(threeJS.labelRenderer)
    expect(container.get(Tokens.Scene)).toBe(threeJS.scene)
    expect(container.get(Tokens.Camera)).toBe(threeJS.camera)
    expect(container.get(Tokens.AstroControls)).toBe(threeJS.astroControls)
    expect(container.get(Tokens.Clock)).toBe(threeJS.clock)
  })
})
