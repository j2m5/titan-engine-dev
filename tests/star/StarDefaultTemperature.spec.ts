import { StarShader } from '@/core/materials/shaders/StarShader'
import { buildStarPalette, DEFAULT_STAR_TEMPERATURE_K } from '@/core/materials/shaders/lib/helpers'
import { Actor } from '@/core/models/Actor'

// Актор с дырой в данных: атрибута temperature нет, getAttribute отдаёт дефолт
function actorWithoutTemperature(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => def
    }
  } as unknown as Actor
}

describe('дефолт температуры звезды', () => {
  it('дефолт солнечный и один на всех', () => {
    // Разные дефолты у диска (было 3000) и билборда (5700) давали цветовой
    // шов на стыке LOD для звёзд без атрибута температуры
    expect(DEFAULT_STAR_TEMPERATURE_K).toBe(5700)
  })

  it('StarShader без атрибута температуры строит палитру от общего дефолта', () => {
    const shader = new StarShader(actorWithoutTemperature())
    const expected = buildStarPalette(DEFAULT_STAR_TEMPERATURE_K)

    expect(shader.uniforms.spectralColor.value).toEqual(expected.base)
    expect(shader.uniforms.uColorCool.value).toEqual(expected.cool)
    expect(shader.uniforms.uColorHot.value).toEqual(expected.hot)
  })
})
