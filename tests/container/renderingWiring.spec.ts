import { describe, it, expect } from 'vitest'
import { Kernel } from '@/core/framework/container/Kernel'
import { Container } from '@/core/framework/container/Container'
import { RenderingServiceProvider } from '@/core/providers/RenderingServiceProvider'
import { Tokens } from '@/core/providers/tokens'

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
})
