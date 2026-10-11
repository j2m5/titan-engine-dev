import { Vector3 } from 'three'
import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'
import { asteroidAppearanceFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidAppearance'

describe('общая поверхность L0/L1', () => {
  it.each([false, true])('материал использует один общий свет и дальний предел (ice=%s)', iceVariety => {
    const shader = new InstancedAsteroidShader({ iceVariety })
    expect(shader.fragmentShader).toContain(asteroidAppearanceFunctions)
    expect(shader.fragmentShader.match(/vec3 shadeAsteroid\(/g)).toHaveLength(1)
    expect(shader.fragmentShader).toContain('shadeAsteroid(vObjectPos, vObjectNormal')
    expect(shader.uniforms.uDetailAverageDiffuse.value).toEqual(new Vector3(1, 1, 1))
    expect(shader.uniforms.uDetailAverageArm.value).toEqual(new Vector3(1, 1, 0))
    expect(shader.vertexShader).toContain('vAsteroidDetailWeight = 1.0')
  })

  it('нулевой вес сохраняет средний цвет и ARM без выборок микрокарт', () => {
    const code = asteroidAppearanceFunctions
    expect(code).toContain('vec3 detail = uDetailAverageDiffuse')
    expect(code).toContain('vec3 arm = uDetailAverageArm')
    expect(code).toContain('if (detailWeight > 0.0)')
    expect(code).toContain('mix(detail, triplanarAlbedo(')
    expect(code).toContain('detailWeight * uDetailNormalScale')
    expect(code).toContain('albedo *= structureTint * uDetailBrightness')
    expect(code).toContain('surfAO *= mix(1.0, arm.r, uDetailAoInfluence)')
  })
})
