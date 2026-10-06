import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import { ringGapFunctions, ringGapUniforms, ringGapUniformValues } from '@/core/materials/shaders/lib/chunks/RingGap'
import { RingShaderTemplate } from '@/core/materials/shaders/lib/RingShaderTemplate'
import { RingDepthMaterial } from '@/core/materials/RingDepthMaterial'
import { ringShadowFunctions } from '@/core/materials/shaders/lib/chunks/RingShadow'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { RING_MOONLETS_MAX, type RingGap } from '@/core/renderables/DetailedRingStreamingSystem/ringMoonlets'
import { Actor } from '@/core/models/Actor'
import { RingShader } from '@/core/materials/shaders/RingShader'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'

describe('чанк RingGap', () => {
  it('слотов столько же, сколько лунок на кольцо; маска — smoothstep по |r − r₀|, произведение', () => {
    expect(ringGapUniforms).toContain(`uniform vec3 uRingGaps[${RING_MOONLETS_MAX}];`)
    expect(ringGapUniforms).toContain('uniform int uRingGapCount;')
    expect(ringGapFunctions).toContain('float ringGapMask(float r)')
    expect(ringGapFunctions).toContain('if (i >= uRingGapCount) break;')
    expect(ringGapFunctions).toContain('mask *= smoothstep(g.y - g.z, g.y, abs(r - g.x));')
    expect(AppShaderChunk.ringGapUniforms).toBe(ringGapUniforms)
    expect(AppShaderChunk.ringGapFunctions).toBe(ringGapFunctions)
  })

  it('ringGapUniformValues: всегда 4 вектора, число щелей — по данным', () => {
    const gaps: RingGap[] = [{ radius: 10, halfWidth: 2, edge: 0.3 }]
    const u = ringGapUniformValues(gaps)
    expect(u.uRingGaps.value).toHaveLength(RING_MOONLETS_MAX)
    expect(u.uRingGaps.value[0]).toEqual(new Vector3(10, 2, 0.3))
    expect(u.uRingGapCount.value).toBe(1)
    expect(ringGapUniformValues([]).uRingGapCount.value).toBe(0)
  })
})

describe('потребители альфы кольца умножают её на маску щели', () => {
  it('меш кольца: до гейта alphaTest', () => {
    const frag = RingShaderTemplate.fragmentShader
    const masked = frag.indexOf('color.a *= ringGapMask(length(vPosition));')
    expect(masked).toBeGreaterThan(-1)
    expect(masked).toBeLessThan(frag.indexOf('if (color.a <= 0.0 || color.a <= alphaTest) discard;'))
  })

  it('проход глубины: та же строка до того же гейта', () => {
    const frag = (RingDepthMaterial as unknown as { fragmentSource: string }).fragmentSource
    const masked = frag.indexOf('color.a *= ringGapMask(length(vPosition));')
    expect(masked).toBeGreaterThan(-1)
    expect(masked).toBeLessThan(frag.indexOf('if (color.a <= 0.0 || color.a <= alphaTest) discard;'))
  })

  it('тень на планете: каждый из 5 тапов — альфа × маска радиуса тапа; чанк подключён под USE_RING до функций тени', () => {
    expect(ringShadowFunctions).toContain('* ringGapMask(shadowRingsInnerRadius + uk * span)')
    const frag = PlanetShaderTemplate.fragmentShader
    const ringBlock = frag.indexOf('#ifdef USE_RING')
    expect(frag.indexOf('#include <ringGapUniforms>')).toBeGreaterThan(ringBlock)
    expect(frag.indexOf('#include <ringGapFunctions>')).toBeLessThan(frag.indexOf('#include <ringShadowFunctions>'))
  })
})

describe('проводка щелей из данных кольца', () => {
  // Конструкторы шейдеров на промахе по ключу зовут PlaceholderTexture (canvas 2d в jsdom нет):
  // засеваем общие ключи и пути ресурсов колец/планет.
  function seed(name: string): void {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
  beforeEach(() => {
    for (const name of ['', 'default.png', 'night.jpg']) seed(name)
    for (const id of [11, 130]) {
      const planet = Actor.find(id)!
      seed(planet.resources.where('resourceType', 'diffuse').first()?.getAttribute('path') as string)
      seed(planet.children.where('categoryId', 6).first()!.resources.first()!.getAttribute('path') as string)
    }
  })
  afterEach(() => resourceStorage.deleteAllTextures())

  it('RingShader Thalorn (actor 132): одна щель в юнитах сцены', () => {
    const u = new RingShader(Actor.find(132)!).uniforms
    expect(u.uRingGapCount.value).toBe(1)
    const g = u.uRingGaps.value[0] as Vector3
    expect(g.x).toBeCloseTo(toThreeJSUnits(106620), 9)
    expect(g.y).toBeCloseTo(toThreeJSUnits(180), 12)
    expect(g.z).toBeCloseTo(0.15 * toThreeJSUnits(180), 12)
  })

  it('PlanetShader Thalorn (actor 130): тень кольца с той же щелью; Сатурн (actor 11) — без щелей (Review Focus 5)', () => {
    expect(new PlanetShader(Actor.find(130)!).uniforms.uRingGapCount.value).toBe(1)
    expect(new PlanetShader(Actor.find(11)!).uniforms.uRingGapCount.value).toBe(0)
  })
})
