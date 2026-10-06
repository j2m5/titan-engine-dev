import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector3, Vector4 } from 'three'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { emptyEclipseData } from '@/core/eclipse/eclipseUniforms'

const wf = WaterShaderTemplate.fragmentShader
const wmain = wf.slice(wf.indexOf('void main()'))

// Блики: у сферы — океан (USE_SPECULAR), у рельефа — мокрая кромка и лёд
const surfaces = [
  ['сфера', SphereSurfaceShaderTemplate.fragmentShader, 1],
  ['рельеф', TerrainShaderTemplate.fragmentShader, 2]
] as const

describe.each(surfaces)('поверхность планеты (%s): затмение', (_path, pf, glints) => {
  const pmain = pf.slice(pf.indexOf('void main()'))

  it('чанки подключены безусловно, свет в точке датума', () => {
    expect(pf).toContain('#include <eclipseFunctions>')
    expect(pf).toContain('#include <eclipseHostFunctions>')
    expect(pmain).toContain('vec3 eclipse = eclipseLight(normalize(vLocalDir) * uBodyRadiusUnits);')
  })
  it('гасит пол, прямой свет, облака и блики, но не ночь', () => {
    expect(pmain).toContain('vec3 ambient = uTerrainAmbient * skyTerm * occlusion * eclipse;')
    expect(pmain).toContain('litDirect *= eclipse;')
    expect(pmain).toContain('cloudRadiance *= eclipseLight(cloudDir * (uBodyRadiusUnits + uCloudHeightUnits));')
    expect(pmain.match(/ringShadowFactor \* terrainShadow \* eclipse;/g)?.length).toBe(glints)
    expect(pmain).not.toMatch(/night[^;\n]*eclipse/)
  })
})

describe('WaterShaderTemplate: затмение', () => {
  it('чанки и радиус тела на верхнем уровне', () => {
    expect(wf).toContain('#include <eclipseFunctions>')
    expect(wf).toContain('#include <eclipseHostFunctions>')
    expect(wf.match(/uniform float uBodyRadiusUnits;/g)?.length).toBe(1)
    expect(wmain).toContain('vec3 eclipse = eclipseLight(normalize(vLocalDir) * uBodyRadiusUnits);')
  })
  it('дневной член фундамента, волны, блик и облака', () => {
    expect(wmain).toContain('color *= mix(vec3(uWaterNightFloor), sunTintFactor * cloudShadow * eclipse, dayFactor);')
    expect(wmain).toContain('color *= mix(vec3(uWaterNightFloor), vec3(cloudShadow) * eclipse, dayFactor);')
    expect(wmain).toContain('waterSunColor * waveDiffuseLight * 0.3 * cloudShadow + waveScatter')
    expect(wmain).not.toContain('cloudShadow * eclipse + waveScatter')
    expect(wmain).toContain('wavesColor *= mix(vec3(uWaterNightFloor), sunTintFactor * eclipse, waveDayFactor);')
    expect(wmain).toContain('wavesColor *= mix(vec3(uWaterNightFloor), eclipse, waveDayFactor);')
    expect(wmain).toContain('uFoamColor * mix(vec3(uWaterNightFloor), sunTintFactor * eclipse, waveDayFactor);')
    expect(wmain).toContain('uFoamColor * mix(vec3(uWaterNightFloor), eclipse, waveDayFactor);')
    expect(wmain).toContain('glint *= cloudShadow * eclipse;')
    expect(wmain).toContain('cloudRadiance *= eclipseLight(cloudDir * (uBodyRadiusUnits + uCloudHeightUnits));')
  })
})

describe.each([
  ['SphereSurfaceMaterial', (actor: Actor) => new SphereSurfaceMaterial(actor)],
  ['TerrainMaterial', (actor: Actor) => new TerrainMaterial(actor)]
] as const)('%s.setEclipse', (_name, make) => {
  beforeEach(() => {
    for (const name of ['', 'default.png', 'night.jpg']) {
      const t = new Texture()
      t.name = name
      t.image = { width: 4, height: 2 }
      resourceStorage.addTexture(t)
    }
    const moonDiffuse = Actor.find(19)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string
    const t = new Texture()
    t.name = moonDiffuse
    t.image = { width: 4, height: 2 }
    resourceStorage.addTexture(t)
  })
  afterEach(() => resourceStorage.deleteAllTextures())

  it('по умолчанию затмений нет; setEclipse копирует значения, не подменяя объекты', () => {
    const m = make(Actor.find(19)!)
    expect(m.uniforms.uEclipseCount.value).toBe(0)
    const occ0 = m.uniforms.uEclipseOccluders.value[0]
    const data = emptyEclipseData()
    data.count = 1
    data.occluders[0].set(1, 2, 3, 0.5)
    data.star.set(-100, 0, 0)
    data.starRadius = 2
    data.umbra[0].set(1, 0, 0, 0.02)
    m.setEclipse(data)
    expect(m.uniforms.uEclipseCount.value).toBe(1)
    expect(m.uniforms.uEclipseOccluders.value[0]).toBe(occ0)
    expect((m.uniforms.uEclipseOccluders.value[0] as Vector4).toArray()).toEqual([1, 2, 3, 0.5])
    expect((m.uniforms.uEclipseStar.value as Vector3).toArray()).toEqual([-100, 0, 0])
    expect(m.uniforms.uEclipseStarRadius.value).toBe(2)
  })
})
