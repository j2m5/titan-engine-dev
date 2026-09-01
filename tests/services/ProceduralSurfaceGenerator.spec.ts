import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProceduralSurfaceGenerator, proceduralDiffuseKey } from '@/core/services/ProceduralSurfaceGenerator'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { Actor } from '@/core/models/Actor'
import type { ProceduralSurfaceParams } from '@/core/terrain/proceduralSurfaceParams'

const VALID_PARAMS: ProceduralSurfaceParams = {
  seed: 931,
  frequencyPerRadius: 3,
  octaves: 6,
  gain: 0.5,
  lacunarity: 2,
  contrast: 1.3,
  palette: ['#1c1414', '#4a241d', '#7a3b28', '#a8683f'],
  albedoNoise: 0.35
}

/**
 * Фикстурный актор без похода в реальную БД: у актора 93 (Korriban I)
 * proceduralSurface появится только Task 6 (см. РУЛИНГ префлайта T4/T6 —
 * порядок задач 1..8 сохраняем, тест не ждёт данных). Приём — тот же, что
 * stubActor в GiantDetailWiring.spec.ts: подменяем геттеры-связи плоским
 * объектом, а не мокаем весь database-модуль («map: new Map()» ломает
 * реальные связи соседних тестов — урок проекта).
 */
function stubActor(id: number, radiusKm: number, data: Record<string, unknown>): Actor {
  return {
    getAttribute: (key: string, fallback?: unknown): unknown => {
      if (key === 'id') return id
      if (key === 'name') return `Stub ${id}`
      return fallback
    },
    renderingObject: { getAttribute: (key: string): unknown => (key === 'data' ? data : undefined) },
    physicalObject: { getAttribute: (key: string): unknown => (key === 'radius' ? radiusKm : undefined) }
  } as unknown as Actor
}

// Мок renderer: считаем вызовы render, RT подменяем реальным WebGLRenderTarget
// (он не требует GL до фактического рендера).
const makeRenderer = () => ({ render: vi.fn(), getRenderTarget: () => null, setRenderTarget: vi.fn() })

describe('ProceduralSurfaceGenerator', () => {
  beforeEach(() => resourceStorage.deleteAllTextures())

  it('ключ синтетический и не пересекается с файловыми путями', () => {
    expect(proceduralDiffuseKey(93)).toBe('procedural://93/diffuse')
  })

  it('ensureDiffuse рендерит один раз, регистрирует текстуру под ключом, повторный вызов — no-op', () => {
    const renderer = makeRenderer()
    const generator = new ProceduralSurfaceGenerator(renderer as never)
    const actor = stubActor(93, 1740, { proceduralSurface: VALID_PARAMS })

    const key = generator.ensureDiffuse(actor)
    expect(resourceStorage.getTexture(key)).toBeDefined()

    const calls = renderer.render.mock.calls.length
    generator.ensureDiffuse(actor)
    expect(renderer.render.mock.calls.length).toBe(calls)
  })

  it('актор без proceduralSurface — громкая ошибка', () => {
    const generator = new ProceduralSurfaceGenerator(makeRenderer() as never)
    const actor = stubActor(19, 1737, {})

    expect(() => generator.ensureDiffuse(actor)).toThrow(/proceduralSurface/)
  })

  it('dispose снимает текстуры и таргеты', () => {
    const generator = new ProceduralSurfaceGenerator(makeRenderer() as never)
    const actor = stubActor(93, 1740, { proceduralSurface: VALID_PARAMS })
    const key = generator.ensureDiffuse(actor)

    generator.dispose()

    expect(resourceStorage.getTexture(key)).toBeUndefined()
  })
})
