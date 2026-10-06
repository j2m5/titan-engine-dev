import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Object3D, Vector4 } from 'three'
import { buildAtmosphereEffectFragment, buildSlotGlsl } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { emptyEclipseData } from '@/core/eclipse/eclipseUniforms'
import { eclipseFunctions } from '@/core/materials/shaders/lib/chunks/Eclipse'

describe('atmosphereSlotShader: затмение', () => {
  it('функции затмения в фрагменте эффекта', () => {
    expect(buildAtmosphereEffectFragment()).toContain(eclipseFunctions.trim().split('\n')[0].trim())
    expect(buildAtmosphereEffectFragment()).toContain('vec3 eclipseLightAt(')
  })

  it('слот: юниформы и множитель рассеяния в точке поверхности или ближайшей к центру точке луча', () => {
    const s = buildSlotGlsl(0)
    expect(s).toContain('uniform int uSlot0_eclipseCount;')
    expect(s).toContain('uniform vec4 uSlot0_eclipseOcc[4];')
    expect(s).toContain('vec3 eclipseQ = hitSurface ? (dir * t1 - center) : (dir * clamp(b, t0, t1) - center);')
    expect(s).toContain('scatter *= eclipseLightAt(eclipseQ, uSlot0_eclipseCount, uSlot0_eclipseOcc, uSlot0_eclipseStar, uSlot0_eclipseStarRadius, uSlot0_eclipseUmbra);')
    // множитель — до колена HDR, пропускание не трогается
    expect(s.indexOf('scatter *= eclipseLightAt(')).toBeLessThan(s.indexOf('vec3 excess'))
    expect(s).toContain('color = color * transmittance + scatter;')
  })
})

describe('AtmosphereEffect: данные затмения в слот', () => {
  it('запись без eclipse — count 0; с eclipse — копия', () => {
    const camera = new PerspectiveCamera()
    const registry = new AtmosphereRegistry()
    const object = new Object3D()
    object.position.set(1, 0, 0)
    object.updateMatrixWorld(true)
    const config = {
      solarIrradiance: [1, 1, 1], sunAngularRadius: 0.004675, bottomRadius: 6360, topRadius: 6420,
      rayleighDensity: [{ width: 0, expTerm: 0, expScale: 0, linearTerm: 0, constantTerm: 0 }, { width: 0, expTerm: 1, expScale: -0.125, linearTerm: 0, constantTerm: 0 }],
      rayleighScattering: [0.0058, 0.0135, 0.0331],
      mieDensity: [{ width: 0, expTerm: 0, expScale: 0, linearTerm: 0, constantTerm: 0 }, { width: 0, expTerm: 1, expScale: -0.833, linearTerm: 0, constantTerm: 0 }],
      mieScattering: [0.004, 0.004, 0.004], mieExtinction: [0.0044, 0.0044, 0.0044], miePhaseFunctionG: 0.8,
      absorptionDensity: [{ width: 25, expTerm: 0, expScale: 0, linearTerm: 0.0667, constantTerm: -0.667 }, { width: 0, expTerm: 0, expScale: 0, linearTerm: -0.0667, constantTerm: 2.667 }],
      absorptionExtinction: [0.00065, 0.00188, 0.000085], groundAlbedo: [0.1, 0.1, 0.1], muSMin: -0.2
    }
    registry.register({ actorId: 5, bodyActorId: 7, name: 'A', object, config: config as never, lut: { transmittance: null, scattering: null, irradiance: null } as never })
    const effect = new AtmosphereEffect(camera, registry)
    effect.update({} as never, {} as never)
    expect(effect.uniforms.get('uSlot0_eclipseCount')!.value).toBe(0)

    const data = emptyEclipseData()
    data.count = 1
    data.occluders[0].set(-384400, 0, 0, 1737)
    data.star.set(-1.5e8, 0, 0)
    data.starRadius = 696000
    registry.get(5)!.eclipse = data
    effect.update({} as never, {} as never)
    expect(effect.uniforms.get('uSlot0_eclipseCount')!.value).toBe(1)
    expect((effect.uniforms.get('uSlot0_eclipseOcc')!.value as Vector4[])[0].toArray()).toEqual([-384400, 0, 0, 1737])
    expect(effect.uniforms.get('uSlot0_eclipseStarRadius')!.value).toBe(696000)
  })
})
