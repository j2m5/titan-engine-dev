import { AdditiveBlending } from 'three'
import { Actor } from '@/core/models/Actor'
import { BrownDwarfHaze, HAZE_RADIUS_SCALE, hazeChord } from '@/core/renderables/BrownDwarf/BrownDwarfHaze'

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

  it('хорда максимальна у кромки и мала в центре диска', () => {
    // Тонкий слой на просвет: у лимба луч идёт по касательной и набирает
    // больше вещества — отсюда свечение кольцом
    const edge = hazeChord(0.02)
    const center = hazeChord(0.99)

    expect(edge).toBeGreaterThan(center * 3)
  })

  it('нулевая сила дымки гасит слой целиком', () => {
    const haze = new BrownDwarfHaze(stubActor())
    haze.material.uniforms.uStrength.value = 0

    expect(haze.material.uniforms.uStrength.value).toBe(0)
  })
})
