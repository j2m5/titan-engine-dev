import { PerspectiveCamera, Vector3 } from 'three'
import { Star } from '@/core/renderables/Star'
import { StarShader } from '@/core/materials/shaders/StarShader'
import {
  STAR_CORE_INTENSITY,
  STAR_GRANULATION_TIME_SCALE,
  STAR_LIMB_COEFF
} from '@/core/materials/shaders/lib/helpers'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'

// getAttribute — единственное, что Star/StarShader читают у Actor; тот же
// приём, что в tests/renderables/ApparentSize.spec.ts
function stubActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 695700 : key === 'temperature' ? 5700 : def
    }
  } as unknown as Actor
}

describe('общие константы поверхности звезды', () => {
  it('значения закреплены: прежние литералы диска', () => {
    // Рассинхронизация этих чисел между LOD — это шов яркости/лимба/времени
    // на переключении; константы — прежние литералы StarShader и Star
    expect(STAR_CORE_INTENSITY).toBe(4.0)
    expect(STAR_LIMB_COEFF).toEqual([0.5, 0.65, 0.8])
    expect(STAR_GRANULATION_TIME_SCALE).toBe(0.01)
  })

  it('юниформы диска читают константы, а не свои копии литералов', () => {
    const shader = new StarShader(stubActor())

    expect(shader.uniforms.uCoreIntensity.value).toBe(STAR_CORE_INTENSITY)
    expect(shader.uniforms.uLimbCoeff.value).toEqual(new Vector3(...STAR_LIMB_COEFF))
  })

  it('время грануляции диска идёт с общим множителем', () => {
    const star = new Star(stubActor())
    const ctx: UpdateContext = { camera: new PerspectiveCamera(50), delta: 0, epoch: 0, elapsed: 123 }

    star.updateObject(ctx)

    expect(star.material.uniforms.time.value).toBe(123 * STAR_GRANULATION_TIME_SCALE)
  })
})
