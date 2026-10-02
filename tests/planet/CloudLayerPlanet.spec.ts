import { describe, expect, it } from 'vitest'
import { RepeatWrapping } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { composeTerrain } from '@/core/materials/shaders/lib/chunks/terrainLightMath'
import { Resources } from '@storage/database'
import type { IResource } from '@/core/models/types'

const vert: string = PlanetShaderTemplate.vertexShader
const frag: string = PlanetShaderTemplate.fragmentShader
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

describe('PlanetShaderTemplate: облачный слой из чанка', () => {
  it('вершинник: взгляд в системе тела из view-space, не из worldPosition', () => {
    expect(vert).toContain('varying vec3 vLocalViewDir;')
    expect(vert).toContain('vLocalViewDir = transpose(mat3(modelMatrix)) * (transpose(mat3(viewMatrix)) * mvPosition.xyz);')
    expect(frag).toContain('varying vec3 vLocalViewDir;')
  })

  it('чанк подключён под USE_CLOUD после тинта солнца; terrainUv — и для легаси-облаков, одним include', () => {
    const inc = frag.indexOf('#include <cloudLayerFunctions>')
    expect(inc).toBeGreaterThan(frag.indexOf('#include <sunTransmittanceFunctions>'))
    expect(openGuards(frag, inc)).toContain('USE_CLOUD')
    expect(frag).toMatch(/#if defined\(USE_TERRAIN_UV\) \|\| defined\(USE_CLOUD\)\s+#include <terrainUvFunctions>\s+#endif/)
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

  it('сборка: облака своим светом, огни гаснут под облаками, блик под облаками', () => {
    expect(main).toContain('vec3 day = cloudRadiance + dayColor * (1.0 - cloudAlphaSlant) * landGate;')
    expect(main).toContain('vec3 finalColor = night * (1.0 - dayFactor) * (1.0 - cloudAlphaSlant) + day;')
    expect(main).toContain('* (1.0 - cloudAlphaSlant) * sunTintMix')
    expect(main).not.toMatch(/\bcloudAlpha\b/)
    expect(main).not.toMatch(/\bcloudColor\b/)
  })

  it('тень облаков на суше — вызов чанка, под USE_TERRAIN_UV и USE_CLOUD_SHADOW', () => {
    const call = frag.indexOf('cloudShadow = cloudShadowAt(dirLocal, sunLocal, muS);')
    expect(call).toBeGreaterThan(-1)
    expect(openGuards(frag, call)).toEqual(expect.arrayContaining(['USE_TERRAIN_UV', 'USE_CLOUD_SHADOW']))
    expect(main).not.toContain('vec2 uvShadow')
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
