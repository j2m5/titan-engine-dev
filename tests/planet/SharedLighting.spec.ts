import { describe, expect, it } from 'vitest'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import {
  planetSurfaceComposite,
  planetSurfaceDirectGain,
  planetSurfaceDirectLight,
  planetSurfaceLightBegin
} from '@/core/materials/shaders/lib/chunks/PlanetSurfaceCommon'
import { composeTerrain, terrainLit } from '@/core/materials/shaders/lib/chunks/terrainLightMath'

const templates = [
  ['сфера', SphereSurfaceShaderTemplate],
  ['рельеф', TerrainShaderTemplate]
] as const

/** Открытые условия препроцессора в точке at (метка '!X' — ветка #else от #ifdef X). */
function openGuards(source: string, at: number): string[] {
  const stack: string[] = []
  const re = /#(ifdef|ifndef|if|else|endif)\b([^\n]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null && m.index < at) {
    const kw = m[1]
    const rest = m[2].trim()
    if (kw === 'endif') stack.pop()
    else if (kw === 'else') stack[stack.length - 1] = '!' + stack[stack.length - 1]
    else stack.push(rest)
  }
  return stack
}

function guardsAt(frag: string, needle: string): string[] {
  const at = frag.indexOf(needle, frag.indexOf('void main()'))
  expect(at, needle).toBeGreaterThan(-1)
  return openGuards(frag, at)
}

describe('общая композиция света: один чанк в обоих шаблонах', () => {
  const chunks = { planetSurfaceLightBegin, planetSurfaceDirectGain, planetSurfaceDirectLight, planetSurfaceComposite }

  it.each(templates)('%s: куски света вставлены целиком, каждый один раз, внутри main', (_path, template) => {
    const frag = template.fragmentShader
    const mainStart = frag.indexOf('void main()')
    for (const [name, chunk] of Object.entries(chunks)) {
      const at = frag.indexOf(chunk)
      expect(at, name).toBeGreaterThan(mainStart)
      expect(frag.indexOf(chunk, at + 1), name).toBe(-1)
    }
  })

  it.each(templates)('%s: ламберт, пол и сборка — вне любых #ifdef', (_path, template) => {
    for (const needle of [
      'vec3 skyTerm = ',
      'vec3 ambient = ',
      'float directGain = ',
      'vec3 lit = mix(ambient',
      'vec3 dayColor = surfaceAlbedo * mix(sunTintMix * eclipse, lit, uTerrainLambert);',
      'float landGate = ',
      'vec3 day = ',
      'vec3 finalColor = '
    ]) {
      expect(guardsAt(template.fragmentShader, needle), needle).toEqual([])
    }
  })

  it.each(templates)('%s: сборка цвета ровно одна, нет легаси-mix и второго day/finalColor', (_path, template) => {
    const frag = template.fragmentShader
    const main = frag.slice(frag.indexOf('void main()'))
    expect(main).not.toContain('mix(night, day, dayFactor)')
    expect(main).not.toMatch(/\bday \*=/)
    expect(main.match(/vec3 day = /g)).toHaveLength(1)
    expect(main.match(/vec3 finalColor = /g)).toHaveLength(1)
    expect(main).toContain('vec3 day = cloudRadiance + dayColor * (1.0 - cloudAlphaSlant) * landGate;')
    expect(main).toContain('vec3 finalColor = night * (1.0 - dayFactor) * (1.0 - cloudAlphaSlant) + day;')
  })

  it.each(templates)('%s: тинт солнца считается один раз, только под USE_SUN_TINT', (_path, template) => {
    const frag = template.fragmentShader
    const main = frag.slice(frag.indexOf('void main()'))
    expect(main.match(/sunTint\(muS\)/g)).toHaveLength(1)
    expect(guardsAt(frag, 'sunTintMix = mix(vec3(1.0), sunTint(muS), uSunTintStrength);')).toEqual(['USE_SUN_TINT'])
  })

  it.each(templates)('%s: терминатор по геометрической нормали', (_path, template) => {
    const main = template.fragmentShader.slice(template.fragmentShader.indexOf('void main()'))
    expect(main).toContain('float terminatorNdotL = sunElevation;')
    expect(main).not.toContain('float terminatorNdotL = NdotLraw;')
  })

  it('рельефные слагаемые — только в шаблоне рельефа, каждое под своим дефайном', () => {
    const frag = TerrainShaderTemplate.fragmentShader
    const sphere = SphereSurfaceShaderTemplate.fragmentShader
    expect(guardsAt(frag, 'vec3 sunLocal = ')).toEqual([])
    expect(guardsAt(frag, 'cloudShadow = cloudShadowAt(')).toEqual(['USE_CLOUD_SHADOW'])
    expect(guardsAt(frag, 'terrainShadow = mix(1.0, terrainShadowMarch(')).toEqual(['USE_TERRAIN_SHADOW'])
    expect(guardsAt(frag, 'surfaceAlbedo = mix(surfaceAlbedo, uFrostColor, frostMask);')).toEqual(['USE_TERRAIN_FROST'])
    for (const needle of ['vec3 sunLocal = ', 'cloudShadowAt(', 'terrainShadowMarch(', 'uFrostColor']) {
      expect(sphere, needle).not.toContain(needle)
    }
  })
})

describe('CPU-зеркало: сфера под ламбертом', () => {
  it('гигант при N·L = 0.5 больше не залит в полную силу: ламберт + пол вместо 1', () => {
    const lit = terrainLit({ ndotl: 0.5, ambient: 0.15, skyTerm: [1, 1, 1], occlusion: 1, kDirect: 0, cloudShadow: 1, lambert: 1 })
    const color = composeTerrain({ night: [0, 0, 0], cloudColor: [0, 0, 0], cloudAlpha: 0, dayColor: lit, dayFactor: 1, lambert: 1 })
    for (const c of [0, 1, 2]) expect(color[c]).toBeCloseTo(0.575, 12)
  })
})
