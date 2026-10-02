import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Group, PerspectiveCamera, Texture, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { WaterSphere } from '@/core/renderables/Water/WaterSphere'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'

// Облачный слой лежит над морем, а рисуется шейдером рельефа ПОД прозрачной водой:
// без своего облачного слоя вода закрывает облака над океаном (глубокая вода α → 1)
const frag: string = WaterShaderTemplate.fragmentShader

function seedTexture(name: string): Texture {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
  return texture
}

const moon = (): Actor => Actor.find(19)!

describe('Шейдер воды: облачный слой поверх воды', () => {
  it('юниформы облаков под USE_WATER_CLOUD', () => {
    // развёртка нужна облакам и без глубины — подключается вложенным #ifndef
    expect(frag).toMatch(
      /#ifdef USE_WATER_CLOUD\s*#ifndef USE_WATER_DEPTH\s*#include <terrainUvFunctions>\s*#endif\s*uniform sampler2D uWaterCloudMap;\s*uniform float uWaterCloudOpacity;\s*#endif/
    )
  })

  it('облако — тем же чанком, что на суше: параллакс, утолщение, свет слоя', () => {
    for (const line of [
      'cloudLayerSample(normalize(vLocalDir), normalize(vLocalViewDir), cloudPremul, cloudAlphaSlant, cloudDir);',
      'vec3 cloudRadiance = cloudLitRadiance(cloudPremul, cloudDir, -normalize(vLocalLightDirection));'
    ]) {
      expect(frag).toContain(line)
    }
  })

  it('слой подмешивается в цвет воды после блика и пены, альфа воды не меняется', () => {
    const composite = frag.indexOf('color = color * (1.0 - cloudAlphaSlant) + cloudRadiance;')
    expect(composite).toBeGreaterThan(frag.indexOf('color += min(glint'))
    expect(composite).toBeLessThan(frag.indexOf('gl_FragColor = vec4(color, alpha);'))
    expect(frag.slice(composite, frag.indexOf('gl_FragColor'))).not.toMatch(/alpha\s*=/)
  })

  it('смешивание даёт ровно «облако поверх (вода поверх суши)»: рельеф под водой несёт те же облака', () => {
    const blend = (src: number, a: number, dst: number): number => src * a + dst * (1 - a)
    for (const [water, alpha, land, cloud, cloudAlpha] of [
      [0.1, 1, 0.4, 0.9, 0.6],
      [0.2, 0.3, 0.5, 0.7, 0.4],
      [0.05, 0, 0.6, 0.8, 1]
    ]) {
      const landWithClouds = land * (1 - cloudAlpha) + cloud
      const waterWithClouds = water * (1 - cloudAlpha) + cloud
      const expected = cloud + (1 - cloudAlpha) * blend(water, alpha, land)
      expect(blend(waterWithClouds, alpha, landWithClouds)).toBeCloseTo(expected, 12)
    }
  })
})

describe('WaterMaterial: облака берутся у материала рельефа', () => {
  beforeEach(() => {
    for (const name of ['', 'default.png', 'night.jpg', moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string]) {
      seedTexture(name)
    }
  })
  afterEach(() => resourceStorage.deleteAllTextures())

  function makeSphere(): WaterSphere {
    return new WaterSphere(moon(), -667.2, { domElement: { height: 1080 } } as unknown as WebGLRenderer)
  }

  it('syncClouds: карта и fade копируются, дефайн ставится и снимается, без лишних перекомпиляций', () => {
    const material = makeSphere().material
    const cloud = new Texture()

    material.syncClouds(cloud, 0.6)
    expect(material.uniforms.uWaterCloudMap.value).toBe(cloud)
    expect(material.uniforms.uWaterCloudOpacity.value).toBe(0.6)
    expect(material.defines.USE_WATER_CLOUD).toBe('1')
    const version = material.version
    material.syncClouds(cloud, 0.4)
    expect(material.version).toBe(version)

    material.updateMaterial()
    expect(material.defines.USE_WATER_CLOUD).toBe('1')

    material.syncClouds(null, 1)
    expect(material.defines.USE_WATER_CLOUD).toBeUndefined()
    expect(material.uniforms.uWaterCloudMap.value).toBeNull()
  })

  it('кадр WaterSphere берёт облака и их fade у PlanetMaterial родителя-рельефа', () => {
    const parent = new Group() as Group & { material: PlanetMaterial }
    const planet = new PlanetMaterial(moon())
    const cloud = new Texture()
    planet.uniforms.cloudMap.value = cloud
    planet.defines = { ...planet.defines, USE_CLOUD: '1' }
    planet.uniforms.uCloudOpacity.value = 0.35
    parent.material = planet
    const sphere = makeSphere()
    parent.add(sphere)

    const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
    camera.position.set(toThreeJSUnits(1736 + 500000), 0, 0)
    camera.updateMatrixWorld(true)
    sphere.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)

    expect(sphere.material.uniforms.uWaterCloudMap.value).toBe(cloud)
    expect(sphere.material.uniforms.uWaterCloudOpacity.value).toBe(0.35)
    expect(sphere.material.defines.USE_WATER_CLOUD).toBe('1')
  })
})
