import { describe, expect, it } from 'vitest'
import { RepeatWrapping } from 'three'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { composeTerrain } from '@/core/materials/shaders/lib/chunks/terrainLightMath'
import { Resources } from '@storage/database'
import type { IResource } from '@/core/models/types'

const templates = [
  ['сфера', SphereSurfaceShaderTemplate],
  ['рельеф', TerrainShaderTemplate]
] as const
const mainOf = (frag: string): string => frag.slice(frag.indexOf('void main()'))
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

describe.each(templates)('%s: облачный слой из чанка', (_path, template) => {
  const vert: string = template.vertexShader
  const frag: string = template.fragmentShader
  const main: string = mainOf(frag)

  it('вершинник: взгляд в системе тела из view-space, не из worldPosition', () => {
    expect(vert).toContain('varying vec3 vLocalViewDir;')
    expect(vert).toContain('vLocalViewDir = transpose(mat3(modelMatrix)) * (transpose(mat3(viewMatrix)) * mvPosition.xyz);')
    expect(frag).toContain('varying vec3 vLocalViewDir;')
  })

  it('чанк подключён под USE_CLOUD после тинта солнца; terrainUv — одним include', () => {
    const inc = frag.indexOf('#include <cloudLayerFunctions>')
    expect(inc).toBeGreaterThan(frag.indexOf('#include <sunTransmittanceFunctions>'))
    expect(openGuards(frag, inc)).toContain('USE_CLOUD')
    expect(frag.match(/#include <terrainUvFunctions>/g)).toHaveLength(1)
    expect(frag).not.toContain('uniform float uCloudShadowStrength;')
    expect(frag).not.toContain('uniform float uCloudHeightUnits;')
  })

  it('облака: точка слоя по лучу взгляда, свет слоя; старого закона нет', () => {
    expect(main).toContain('cloudLayerSample(normalize(vLocalDir), normalize(vLocalViewDir), cloudPremul, cloudAlphaSlant, cloudDir);')
    expect(main).toContain('cloudRadiance = cloudLitRadiance(cloudPremul, cloudDir, -normalize(vLocalLightDirection));')
    expect(main).not.toContain('0.5 * cloudLight + 0.1')
    expect(main).not.toContain('texture2D(cloudMap, uv)')
  })

  it('сборка: облака своим светом, огни гаснут под облаками', () => {
    expect(main).toContain('vec3 day = cloudRadiance + dayColor * (1.0 - cloudAlphaSlant) * landGate;')
    expect(main).toContain('vec3 finalColor = night * (1.0 - dayFactor) * (1.0 - cloudAlphaSlant) + day;')
    expect(main).not.toMatch(/\bcloudAlpha\b/)
    expect(main).not.toMatch(/\bcloudColor\b/)
  })
})

describe('облачный слой: различия путей', () => {
  const sphereFrag: string = SphereSurfaceShaderTemplate.fragmentShader
  const terrainFrag: string = TerrainShaderTemplate.fragmentShader

  it('сфера: terrainUv только под USE_CLOUD (диффуз по vUv); рельеф: без гейта', () => {
    expect(sphereFrag).toMatch(/#ifdef USE_CLOUD\s+#include <terrainUvFunctions>\s+#endif/)
    expect(openGuards(terrainFrag, terrainFrag.indexOf('#include <terrainUvFunctions>'))).toEqual([])
  })

  it('блик воды на сфере гаснет под облаками', () => {
    expect(mainOf(sphereFrag)).toContain('* (1.0 - cloudAlphaSlant) * sunTintMix')
  })

  it('тень облаков на суше — вызов чанка только у рельефа, под USE_CLOUD_SHADOW', () => {
    const call = terrainFrag.indexOf('cloudShadow = cloudShadowAt(dirLocal, sunLocal, muS);')
    expect(call).toBeGreaterThan(-1)
    expect(openGuards(terrainFrag, call)).toEqual(['USE_CLOUD_SHADOW'])
    expect(sphereFrag).not.toContain('cloudShadowAt(')
    expect(mainOf(terrainFrag)).not.toContain('vec2 uvShadow')
  })
})

describe('CPU-зеркало новой сборки', () => {
  it('огни гаснут под облаком, облако не гейтится dayFactor', () => {
    const c = composeTerrain({ night: [1, 1, 1], cloudColor: [0.3, 0.3, 0.3], cloudAlpha: 0.5, dayColor: [0, 0, 0], dayFactor: 0, lambert: 1 })
    for (const k of [0, 1, 2]) expect(c[k]).toBeCloseTo(1 * 1 * 0.5 + 0.3, 12)
  })
})

describe('данные: карты облаков читаются по terrainUv', () => {
  it('страж: каждая строка cloud несёт wrapS RepeatWrapping (u второго домена < 0)', () => {
    const clouds = Resources.filter((r: IResource): boolean => r.resourceType === 'cloud')
    expect(clouds.length).toBeGreaterThan(0)
    for (const r of clouds) expect(r.wrapS, r.path).toBe(RepeatWrapping)
  })
})
