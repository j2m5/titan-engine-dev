import { describe, it, expect } from 'vitest'
import { starActivityOf } from '@/core/renderables/utils/starActivity'
import { Star } from '@/core/renderables/Star'
import { StarOuterLayer } from '@/core/renderables/utils/StarOuterLayer'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { STAR_LIMB_COEFF } from '@/core/materials/shaders/lib/helpers'
import { Actor } from '@/core/models/Actor'
import type { Vector3, WebGLRenderer } from 'three'

/** Стаб актора звезды: физика с температурой и радиусом, rendering-строка по желанию */
const starActor = (temperature: number, data: Record<string, unknown> | null = null): Actor =>
  ({
    physicalObject: {
      getAttribute: (k: string, f: unknown = 0): unknown => (k === 'temperature' ? temperature : k === 'radius' ? 696000 : f)
    },
    renderingObject: data ? { getAttribute: (): unknown => data } : null,
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'name' ? 'S' : f)
  }) as unknown as Actor

describe('starActivityOf: конвективная активность по температуре', () => {
  it('солнечные и более холодные звёзды — полная активность (Солнце, Хорусет, Tatoo I, красные карлики)', () => {
    for (const t of [3354, 5778, 6050, 6400, 7000]) expect(starActivityOf(t), `${t} K`).toBe(1)
  })

  it('горячие звёзды — нулевая (Сириус A, Алькаид)', () => {
    for (const t of [9000, 9940, 15540, 30000]) expect(starActivityOf(t), `${t} K`).toBe(0)
  })

  it('между 7 000 и 9 000 К — гладкий монотонный спад, середина 0.5', () => {
    expect(starActivityOf(8000)).toBeCloseTo(0.5, 6)
    let prev = 1
    for (let t = 7000; t <= 9000; t += 100) {
      const a = starActivityOf(t)
      expect(a).toBeLessThanOrEqual(prev)
      prev = a
    }
  })
})

describe('Star: грануляция и лимб по активности', () => {
  it('Солнце: юниформы прежние — грануляция 1, лимб = STAR_LIMB_COEFF', () => {
    const star = new Star(starActor(5778))
    const u = star.material.uniforms

    expect(u.uGranulation.value).toBe(1)
    expect((u.uLimbCoeff.value as Vector3).toArray()).toEqual([...STAR_LIMB_COEFF])
  })

  it('Алькаид: грануляция 0, потемнение к лимбу вдвое слабее', () => {
    const star = new Star(starActor(15540))
    const u = star.material.uniforms

    expect(u.uGranulation.value).toBe(0)
    expect((u.uLimbCoeff.value as Vector3).toArray()).toEqual(STAR_LIMB_COEFF.map((c) => c * 0.5))
  })

  it('ручка activity в строке rendering перекрывает температуру', () => {
    const star = new Star(starActor(15540, { lightTint: 0.8, activity: 1 }))

    expect(star.material.uniforms.uGranulation.value).toBe(1)
  })
})

describe('FakeStar (импостор): та же активность, что у диска — стык LOD без скачка', () => {
  it('Солнце — грануляция 1 и прежний лимб; Алькаид — 0 и лимб вдвое слабее', () => {
    const renderer = { domElement: { height: 1080 } } as unknown as WebGLRenderer
    const sun = new FakeStar(starActor(5778), renderer)
    const alkaid = new FakeStar(starActor(15540), renderer)

    expect(sun.material.uniforms.uGranulation.value).toBe(1)
    expect((sun.material.uniforms.uLimbCoeff.value as Vector3).toArray()).toEqual([...STAR_LIMB_COEFF])
    expect(alkaid.material.uniforms.uGranulation.value).toBe(0)
    expect((alkaid.material.uniforms.uLimbCoeff.value as Vector3).toArray()).toEqual(STAR_LIMB_COEFF.map((c) => c * 0.5))
  })
})

describe('StarOuterLayer: протуберанцы только у активных звёзд', () => {
  it('Солнце — слой виден и с геометрией', () => {
    const layer = new StarOuterLayer(starActor(5778))

    expect(layer.visible).toBe(true)
    expect(layer.geometry.getAttribute('position') ?? layer.geometry.index).toBeTruthy()
  })

  it('Алькаид — слой невидим и без лент', () => {
    const layer = new StarOuterLayer(starActor(15540))

    expect(layer.visible).toBe(false)
  })
})
