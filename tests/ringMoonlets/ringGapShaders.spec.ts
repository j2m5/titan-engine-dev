import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import { ringGapFunctions, ringGapUniforms, ringGapUniformValues } from '@/core/materials/shaders/lib/chunks/RingGap'
import { RingShaderTemplate } from '@/core/materials/shaders/lib/RingShaderTemplate'
import { RingDepthMaterial } from '@/core/materials/RingDepthMaterial'
import { ringShadowFunctions } from '@/core/materials/shaders/lib/chunks/RingShadow'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { RING_MOONLETS_MAX, type RingGap } from '@/core/renderables/DetailedRingStreamingSystem/ringMoonlets'
import { Actor } from '@/core/models/Actor'
import { RingShader } from '@/core/materials/shaders/RingShader'
import { SphereSurfaceShader } from '@/core/materials/shaders/SphereSurfaceShader'
import { TerrainShader } from '@/core/materials/shaders/TerrainShader'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resourceStorage } from '@/core/services/ResourceStorage'

describe('чанк RingGap', () => {
  it('слотов столько же, сколько лунок на кольцо; маска — smoothstep по |r − r₀|, произведение', () => {
    expect(ringGapUniforms).toContain(`uniform vec3 uRingGaps[${RING_MOONLETS_MAX}];`)
    expect(ringGapUniforms).toContain('uniform int uRingGapCount;')
    expect(ringGapFunctions).toContain('float ringGapMask(float r)')
    expect(ringGapFunctions).toContain('if (i >= uRingGapCount) break;')
    expect(ringGapFunctions).toContain('mask *= smoothstep(g.y - g.z, g.y, abs(r - g.x));')
    // Сглаживание издали: край не уже пикселя, глубина щели — доля покрытия пикселя
    expect(ringGapFunctions).toContain('float ringGapMaskAA(float r, float fw)')
    expect(ringGapFunctions).toContain('float e = max(g.z, fw);')
    expect(ringGapFunctions).toContain('float depth = clamp(2.0 * g.y / max(fw, 1e-9), 0.0, 1.0);')
    expect(ringGapFunctions).toContain('mask *= 1.0 - depth * (1.0 - smoothstep(g.y - e, g.y, abs(r - g.x)));')
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
  // Радиус и fwidth — первыми в main(), в однородном потоке (до раннего выхода по радиусу)
  const RADIUS_LINE = 'float ringR = length(vPosition);'
  const FWIDTH_LINE = 'float ringFw = fwidth(ringR);'
  const MASK_LINE = 'color.a *= ringGapMaskAA(ringR, ringFw);'
  const gate = 'if (color.a <= 0.0 || color.a <= alphaTest) discard;'
  const meshFrag = RingShaderTemplate.fragmentShader
  const depthFrag = (RingDepthMaterial as unknown as { fragmentSource: string }).fragmentSource
  const cases: Array<[string, string, string]> = [
    ['меш кольца', meshFrag, 'if (uv.x < 0.0 || uv.x > 1.0) {'],
    ['проход глубины', depthFrag, 'if (uv.x < 0.0 || uv.x > 1.0) discard;']
  ]
  /** Блок от начала main() до строки fwidth включительно */
  const headBlock = (frag: string): string => {
    const start = frag.indexOf('void main() {')
    return frag.slice(start, frag.indexOf(FWIDTH_LINE, start) + FWIDTH_LINE.length)
  }

  it.each(cases)('%s: радиус и fwidth в начале main() — до раннего выхода по радиусу и выборки текстуры', (_name, frag, earlyExit) => {
    const main = frag.indexOf('void main() {')
    const radius = frag.indexOf(RADIUS_LINE)
    const fw = frag.indexOf(FWIDTH_LINE)
    expect(main).toBeGreaterThan(-1)
    expect(radius).toBeGreaterThan(main)
    expect(fw).toBeGreaterThan(radius)
    expect(frag.indexOf(earlyExit)).toBeGreaterThan(fw)
    expect(frag.indexOf('texture2D(diffuseMap, uv)')).toBeGreaterThan(fw)
    // В main() производная радиуса — одна, и только в однородном потоке
    expect(frag.slice(main).split('fwidth(').length - 1).toBe(1)
  })

  it.each(cases)('%s: маска со сглаживанием до гейта alphaTest, после раннего выхода', (_name, frag, earlyExit) => {
    const masked = frag.indexOf(MASK_LINE)
    expect(masked).toBeGreaterThan(frag.indexOf(earlyExit))
    expect(masked).toBeLessThan(frag.indexOf(gate))
    expect(frag).not.toContain('ringGapMask(length(vPosition))')
  })

  it('пре-пасс — подмножество меша: начало main() и строка маски дословно одинаковы', () => {
    expect(headBlock(depthFrag)).toBe(headBlock(meshFrag))
    expect(depthFrag.split(MASK_LINE).length - 1).toBe(1)
    expect(meshFrag.split(MASK_LINE).length - 1).toBe(1)
  })

  it.each([
    ['сфера', SphereSurfaceShaderTemplate.fragmentShader],
    ['рельеф', TerrainShaderTemplate.fragmentShader]
  ])('тень на планете (%s): каждый из 5 тапов — альфа × маска радиуса тапа; чанк подключён под USE_RING до функций тени', (_path, frag) => {
    expect(ringShadowFunctions).toContain('* ringGapMask(shadowRingsInnerRadius + uk * span)')
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

  it.each([
    ['SphereSurfaceShader', (actor: Actor) => new SphereSurfaceShader(actor)],
    ['TerrainShader', (actor: Actor) => new TerrainShader(actor)]
  ] as const)('%s Thalorn (actor 130): тень кольца с той же щелью; Сатурн (actor 11) — без щелей (Review Focus 5)', (_name, make) => {
    expect(make(Actor.find(130)!).uniforms.uRingGapCount.value).toBe(1)
    expect(make(Actor.find(11)!).uniforms.uRingGapCount.value).toBe(0)
  })
})
