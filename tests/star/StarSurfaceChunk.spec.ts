import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { starSurface } from '@/core/materials/shaders/lib/chunks/StarSurface'
import { StarShader } from '@/core/materials/shaders/StarShader'
import { StarShaderTemplate } from '@/core/materials/shaders/lib/StarShaderTemplate'
import { Actor } from '@/core/models/Actor'

function stubActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'temperature' ? 5700 : def)
    }
  } as unknown as Actor
}

describe('чанк starSurface: одна формула поверхности на оба LOD', () => {
  it('зарегистрирован в AppShaderChunk', () => {
    // Диск включает чанк через #include <starSurface>, который резолвит
    // AbstractShader.prepareSource по этому реестру
    expect(AppShaderChunk.starSurface).toBe(starSurface)
  })

  it('несёт формулы поверхности: fbm 6/0.9, ремап ×4, энергия, лимб', () => {
    expect(starSurface).toContain('float fbm(')
    expect(starSurface).toContain('0.5 + fbm(noisePos, 6, 0.9) * 4.0')
    expect(starSurface).toContain('mix(0.55, 3.0, t)')
    expect(starSurface).toContain('limbCoeff * (1.0 - mu)')
  })

  it('диск собирается с чанком: include резолвится в текст чанка', () => {
    const shader = new StarShader(stubActor())

    expect(shader.fragmentShader).toContain('float starGranulationT(')
    expect(shader.fragmentShader).not.toContain('#include <starSurface>')
  })

  it('шаблон диска не держит собственной копии формул', () => {
    // Дубль формулы — это будущая рассинхронизация LOD при первой правке
    expect(StarShaderTemplate.fragmentShader).toContain('#include <starSurface>')
    expect(StarShaderTemplate.fragmentShader).not.toContain('float fbm(')
  })
})
