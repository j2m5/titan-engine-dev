import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { composeTerrain, terrainLit } from '@/core/materials/shaders/lib/chunks/terrainLightMath'

const frag: string = PlanetShaderTemplate.fragmentShader
const mainStart: number = frag.indexOf('void main()')
const main: string = frag.slice(mainStart)

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

function guardsAt(needle: string): string[] {
  const at = frag.indexOf(needle, mainStart)
  expect(at, needle).toBeGreaterThan(-1)
  return openGuards(frag, at)
}

describe('PlanetShaderTemplate: одно освещение на обе ветки', () => {
  it('ламберт, пол и сборка — вне USE_TERRAIN_UV (легаси-сфера получает тот же свет)', () => {
    for (const needle of [
      'vec3 skyTerm = ',
      'vec3 ambient = ',
      'float directGain = ',
      'vec3 lit = mix(ambient',
      'vec3 dayColor = surfaceAlbedo * mix(sunTintMix, lit, uTerrainLambert);',
      'float landGate = ',
      'vec3 day = ',
      'vec3 finalColor = '
    ]) {
      const guards = guardsAt(needle)
      expect(guards, needle).not.toContain('USE_TERRAIN_UV')
      expect(guards, needle).not.toContain('!USE_TERRAIN_UV')
    }
  })

  it('сборка цвета ровно одна: нет легаси-mix и второго day/finalColor', () => {
    expect(main).not.toContain('mix(night, day, dayFactor)')
    expect(main).not.toMatch(/\bday \*=/)
    expect(main.match(/vec3 day = /g)).toHaveLength(1)
    expect(main.match(/vec3 finalColor = /g)).toHaveLength(1)
    expect(main).toContain('vec3 day = cloudRadiance + dayColor * (1.0 - cloudAlphaSlant) * landGate;')
    expect(main).toContain('vec3 finalColor = night * (1.0 - dayFactor) * (1.0 - cloudAlphaSlant) + day;')
  })

  it('тинт солнца считается один раз, вне USE_TERRAIN_UV', () => {
    expect(main.match(/sunTint\(muS\)/g)).toHaveLength(1)
    const guards = guardsAt('sunTintMix = mix(vec3(1.0), sunTint(muS), uSunTintStrength);')
    expect(guards).toContain('USE_SUN_TINT')
    expect(guards).not.toContain('USE_TERRAIN_UV')
  })

  it('терминатор по геометрической нормали в обеих ветках', () => {
    expect(main).toContain('float terminatorNdotL = sunElevation;')
    expect(main).not.toContain('float terminatorNdotL = NdotLraw;')
  })

  it('рельефные слагаемые остаются под USE_TERRAIN_UV', () => {
    expect(guardsAt('vec3 sunLocal = ')).toContain('USE_TERRAIN_UV')
    expect(guardsAt('cloudShadow = cloudShadowAt(')).toEqual(expect.arrayContaining(['USE_TERRAIN_UV', 'USE_CLOUD_SHADOW']))
    expect(guardsAt('terrainShadow = mix(1.0, terrainShadowMarch(')).toEqual(expect.arrayContaining(['USE_TERRAIN_UV', 'USE_TERRAIN_SHADOW']))
    expect(guardsAt('surfaceAlbedo = mix(surfaceAlbedo, uFrostColor, frostMask);')).toEqual(expect.arrayContaining(['USE_TERRAIN_UV', 'USE_TERRAIN_FROST']))
  })
})

describe('CPU-зеркало: легаси-сфера под ламбертом', () => {
  it('гигант при N·L = 0.5 больше не залит в полную силу: ламберт + пол вместо 1', () => {
    const lit = terrainLit({ ndotl: 0.5, ambient: 0.15, skyTerm: [1, 1, 1], occlusion: 1, kDirect: 0, cloudShadow: 1, lambert: 1 })
    const color = composeTerrain({ night: [0, 0, 0], cloudColor: [0, 0, 0], cloudAlpha: 0, dayColor: lit, dayFactor: 1, lambert: 1 })
    for (const c of [0, 1, 2]) expect(color[c]).toBeCloseTo(0.575, 12)
  })
})
