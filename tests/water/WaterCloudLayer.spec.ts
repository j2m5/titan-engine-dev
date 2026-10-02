import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { WaterShader } from '@/core/materials/shaders/WaterShader'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'

const vert: string = WaterShaderTemplate.vertexShader
const frag: string = WaterShaderTemplate.fragmentShader
const main: string = frag.slice(frag.indexOf('void main()'))
const strip = (s: string): string => s.replace(/\/\/[^\n]*/g, '')

function openGuards(source: string, at: number): string[] {
  const stack: string[] = []
  const re = /#(ifdef|ifndef|if|else|endif)\b([^\n]*)/g
  const clean = strip(source.slice(0, at))
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const kw = m[1]
    if (kw === 'endif') stack.pop()
    else if (kw === 'else') stack[stack.length - 1] = '!' + stack[stack.length - 1]
    else stack.push(m[2].trim())
  }
  return stack
}

describe('WaterShaderTemplate: облачный слой из чанка', () => {
  it('вершинник: тот же взгляд в системе тела, что у суши', () => {
    expect(vert).toContain('varying vec3 vLocalViewDir;')
    expect(vert).toContain('vLocalViewDir = transpose(mat3(modelMatrix)) * (transpose(mat3(viewMatrix)) * mvPosition.xyz);')
  })

  it('чанк под USE_WATER_CLOUD, имена воды — макросами, после тинта солнца', () => {
    const inc = frag.indexOf('#include <cloudLayerFunctions>')
    expect(openGuards(frag, inc)).toContain('USE_WATER_CLOUD')
    expect(inc).toBeGreaterThan(frag.indexOf('#include <sunTransmittanceFunctions>'))
    const before = frag.slice(frag.lastIndexOf('#ifdef USE_WATER_CLOUD', inc), inc)
    expect(before).toContain('#define cloudMap uWaterCloudMap')
    expect(before).toContain('#define uCloudOpacity uWaterCloudOpacity')
    expect(before).toContain('uniform float uBodyRadiusUnits;')
    expect(before).toContain('#include <cloudLayerUniforms>')
  })

  it('облака над водой — чанком; старого закона нет', () => {
    expect(main).toContain('cloudLayerSample(normalize(vLocalDir), normalize(vLocalViewDir), cloudPremul, cloudAlphaSlant, cloudDir);')
    expect(main).toContain('color = color * (1.0 - cloudAlphaSlant) + cloudRadiance;')
    expect(main).not.toContain('0.5 * cloudLight + 0.1')
  })

  it('тень облаков: фундамент, солнечный член волн и блик', () => {
    const decl = frag.indexOf('float cloudShadow = 1.0;')
    expect(decl).toBeGreaterThan(-1)
    expect(frag.indexOf('cloudShadow = cloudShadowAt(')).toBeGreaterThan(decl)
    expect(main).toContain('color *= mix(vec3(uWaterNightFloor), sunTintFactor * cloudShadow, dayFactor);')
    expect(main).toContain('color *= mix(uWaterNightFloor, cloudShadow, dayFactor);')
    expect(main).toContain('waterSunColor * waveDiffuseLight * 0.3 * cloudShadow + waveScatter')
    expect(main).toContain('glint *= cloudShadow;')
    expect(main.indexOf('glint *= cloudShadow;')).toBeLessThan(main.indexOf('color += min(glint'))
  })
})

function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

function stubBodyActor(data: Record<string, unknown>): Actor {
  return {
    renderingObject: { getAttribute: () => data },
    physicalObject: { getAttribute: (k: string, d?: unknown) => (k === 'radius' ? 6371 : d) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: { where: () => ({ first: () => undefined }) }
  } as unknown as Actor
}

describe('паритет ручек облаков у воды и суши одного тела', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('заданные в данных высота, мягкость и сила тени совпадают', () => {
    const actor = stubBodyActor({ emission: 1, bumpScale: 1, waterLevelMeters: 0, cloudHeightKm: 9, cloudLightSoftness: 0.25, cloudShadowStrength: 0.4 })
    const planet = new PlanetShader(actor)
    const water = new WaterShader(actor)
    for (const u of ['uCloudHeightUnits', 'uCloudHeightKm', 'uCloudLightSoftness', 'uCloudShadowStrength'] as const) {
      expect((water.uniforms as Record<string, { value: unknown }>)[u].value, u).toBe((planet.uniforms as Record<string, { value: unknown }>)[u].value)
    }
    expect((water.uniforms as Record<string, { value: unknown }>).uCloudHeightKm.value).toBe(9)
    expect(water.uniforms.uBodyRadiusUnits.value).toBe(planet.uniforms.uBodyRadiusUnits.value)
    expect(planet.uniforms.uBodyRadiusUnits.value).toBe(toThreeJSUnits(6371))
  })
})
