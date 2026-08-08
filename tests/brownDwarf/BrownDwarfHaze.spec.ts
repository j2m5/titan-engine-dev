import { AdditiveBlending } from 'three'
import { Actor } from '@/core/models/Actor'
import { BrownDwarfHaze, HAZE_RADIUS_SCALE, hazeLimbProfile } from '@/core/renderables/BrownDwarf/BrownDwarfHaze'

function stubActor(): Actor {
  return {
    getAttribute: (_key: string, def?: unknown): unknown => def ?? 'Dwarf',
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def)
    }
  } as unknown as Actor
}

describe('дымка над лимбом', () => {
  it('оболочка больше тела и не пишет в глубину', () => {
    const haze = new BrownDwarfHaze(stubActor())

    expect(HAZE_RADIUS_SCALE).toBeGreaterThan(1)
    expect(haze.material.depthWrite).toBe(false)
    expect(haze.material.blending).toBe(AdditiveBlending)
  })

  it('профиль монотонно спадает от кромки к центру диска', () => {
    // Тонкий слой на просвет: у лимба луч набирает больше вещества — отсюда
    // свечение кольцом. Проверяется монотонность, а не одна пара точек:
    // немонотонный профиль дал бы кольцо не там, где кромка
    const samples = [0.02, 0.2, 0.4, 0.6, 0.8, 0.99].map((mu) => hazeLimbProfile(mu))

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1])
    }

    expect(samples[0]).toBeGreaterThan(samples[samples.length - 1] * 3)
  })

  it('нулевая сила дымки гасит слой целиком', () => {
    const haze = new BrownDwarfHaze(stubActor())
    haze.material.uniforms.uStrength.value = 0

    expect(haze.material.uniforms.uStrength.value).toBe(0)
  })
})
