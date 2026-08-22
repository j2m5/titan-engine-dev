import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { RenderingObjects } from '@storage/database'

const TERRAFORM_HEIGHT_PATH = 'stub/giant-detail/height.raw'
const TERRAFORM_DIFFUSE_PATH = 'stub/giant-detail/diffuse.png'

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/**
 * Конструктор PlanetShader ходит через getTextureOrMake за 'default.png',
 * 'night.jpg' и '' (заглушка кольца) — промах строит PlaceholderTexture на
 * канвасе, которого в jsdom нет (образец: TerrainLambert.spec.ts).
 */
function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg', TERRAFORM_DIFFUSE_PATH]) seedTexture(name)
}

/** Материал спрашивает у реестра только факт наличия карты (см. PlanetMaterialMaps.spec.ts). */
function seedHeightField(path: string): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(path, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

/** Стаб легаси-тела: радиус в physicalObject, ручки в renderingObject.data. */
function stubActor(
  physical: { radius: number },
  data: Record<string, unknown>,
  pathByType: Record<string, string> = {}
): Actor {
  return {
    renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 1, ...data }) },
    physicalObject: { getAttribute: () => physical.radius },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => {
          const path = pathByType[type]

          return path === undefined ? undefined : { getAttribute: () => path }
        }
      })
    }
  } as unknown as Actor
}

/** Терраформный стаб: height-ресурс есть и карта загружена — деталь гиганта такому телу не положена. */
function stubTerraformActor(data: Record<string, unknown>): Actor {
  return stubActor({ radius: 1737 }, data, {
    diffuse: TERRAFORM_DIFFUSE_PATH,
    height: TERRAFORM_HEIGHT_PATH
  })
}

describe('PlanetShaderTemplate: деталь гиганта в легаси-ветке', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader

  it('чанки включены под гейтом, после noiseFunctions и объявления diffuseMap', () => {
    expect(frag).toContain('#include <giantDetailUniforms>')
    expect(frag).toContain('#include <giantDetailFunctions>')
    expect(frag.indexOf('#include <noiseFunctions>')).toBeLessThan(frag.indexOf('#include <giantDetailFunctions>'))
    expect(frag.indexOf('uniform sampler2D diffuseMap;')).toBeLessThan(frag.indexOf('#include <giantDetailFunctions>'))
    const gate = frag.indexOf('#ifdef USE_GIANT_DETAIL')
    expect(gate).toBeGreaterThan(-1)
  })

  it('вызов в ветке #else (легаси), до dayColor *= albedoMul, с одной выборкой диффуза', () => {
    const elseBranch = frag.indexOf('vec2 uv = vUv;')
    const call = frag.indexOf(
      'applyGiantDetail(albedoMul, normalize(vPosition), uv, dot(diffuseSample, vec3(0.2126, 0.7152, 0.0722)), length(vViewPosition));'
    )
    const mul = frag.indexOf('dayColor *= albedoMul;')
    expect(call).toBeGreaterThan(elseBranch)
    expect(mul).toBeGreaterThan(call)
    expect(frag).toContain('vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;')
    expect(frag).toContain('vec3 dayColor = diffuseSample;')
    // по одной выборке диффуза на ветку UV (терраформ / легаси); выборки dLum живут в чанке, не в шаблоне
    expect(frag.match(/texture2D\(diffuseMap, uv\)/g)).toHaveLength(2)
  })
})

describe('PlanetShader: ручки детали гиганта', () => {
  beforeEach(seedPlaceholderKeys)
  afterEach(() => resourceStorage.deleteAllTextures())

  it('дефолты: strength 0.35, scale 400, stretch 6, warp 0.6, textureWarp 2, fade 3·R в юнитах, радиус из physicalObject', () => {
    const shader = new PlanetShader(stubActor({ radius: 69911 }, {}))
    expect(shader.uniforms.uGiantRadiusKm.value).toBe(69911)
    expect(shader.uniforms.uGiantDetailStrength.value).toBe(0.35)
    expect(shader.uniforms.uGiantDetailScaleKm.value).toBe(400)
    expect(shader.uniforms.uGiantDetailStretch.value).toBe(6)
    expect(shader.uniforms.uGiantDetailWarp.value).toBe(0.6)
    expect(shader.uniforms.uGiantDetailTextureWarp.value).toBe(2)
    expect(shader.uniforms.uGiantDetailFadeUnits.value).toBeCloseTo(toThreeJSUnits(3 * 69911), 12)
  })

  it('ручки из data', () => {
    const shader = new PlanetShader(
      stubActor(
        { radius: 1000 },
        {
          giantDetailStrength: 0.1,
          giantDetailScaleKm: 50,
          giantDetailStretch: 3,
          giantDetailWarp: 0,
          giantDetailTextureWarp: 1,
          giantDetailFadeKm: 9000
        }
      )
    )
    expect(shader.uniforms.uGiantDetailStrength.value).toBe(0.1)
    expect(shader.uniforms.uGiantDetailScaleKm.value).toBe(50)
    expect(shader.uniforms.uGiantDetailStretch.value).toBe(3)
    expect(shader.uniforms.uGiantDetailWarp.value).toBe(0)
    expect(shader.uniforms.uGiantDetailTextureWarp.value).toBe(1)
    expect(shader.uniforms.uGiantDetailFadeUnits.value).toBeCloseTo(toThreeJSUnits(9000), 12)
  })
})

describe('PlanetMaterial: дефайн USE_GIANT_DETAIL', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    // Диффуз тела и текстура колец идут через getTextureOrMake — их тоже сеем
    const saturn = Actor.find(11)!
    seedTexture(saturn.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
    seedTexture(saturn.children.where('categoryId', 6).first()!.resources.first()!.getAttribute('path') as string)
    seedTexture(Actor.find(19)!.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
  })
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
  })

  it('Сатурн (actor 11): giantDetail в данных, карты высот нет → дефайн', () => {
    const m = new PlanetMaterial(Actor.find(11)!)
    m.updateMaterial()
    expect(m.defines.USE_GIANT_DETAIL).toBe('1')
  })

  it('без ручки — дефайна нет (Луна, actor 19)', () => {
    const m = new PlanetMaterial(Actor.find(19)!)
    m.updateMaterial()
    expect(m.defines.USE_GIANT_DETAIL).toBeUndefined()
  })

  it('терраформное тело с giantDetail: true и загруженной картой высот — дефайна нет', () => {
    seedHeightField(TERRAFORM_HEIGHT_PATH)

    const m = new PlanetMaterial(stubTerraformActor({ giantDetail: true }))
    m.updateMaterial()
    expect(m.defines.USE_GIANT_DETAIL).toBeUndefined()
  })
})

describe('данные: четыре гиганта с деталью', () => {
  it.each([10, 11, 12, 13])('actor %i: renderingObject с giantDetail: true', (actorId) => {
    const row = (RenderingObjects as unknown as Array<{ actorId: number; data: { giantDetail?: boolean } }>).find(
      (r) => r.actorId === actorId
    )
    expect(row?.data.giantDetail).toBe(true)
  })
})
