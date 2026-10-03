import { describe, expect, it } from 'vitest'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { terrainNearShadowFunctions } from '@/core/materials/shaders/lib/chunks/TerrainNearShadow'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { combineTerrainShadow, NEAR_SHADOW_BIAS_SLOPE, NEAR_SHADOW_STEPS } from '@/core/terrain/terrainNearShadowMath'
import { preprocessGlsl } from '../helpers/glsl'

const chunk = terrainNearShadowFunctions
const frag: string = TerrainShaderTemplate.fragmentShader

const FAR_LINE = 'if (NdotLraw > 0.0) terrainShadow = mix(1.0, terrainShadowMarch(dirLocal, sunLocal), uTerrainShadowStrength);'
const NEAR_GATE = 'if (NdotLraw > 0.0 && uNearTileWeight > 0.0) {'
const NEAR_COMBINE = 'if (nearWeight > 0.0) terrainShadow = min(terrainShadow, mix(1.0, terrainNearShadowMarch(dirLocal, sunLocal), nearWeight));'

/** Индекс имени в его объявлении (переменная, параметр, юниформ, функция) или -1. */
function declarationAt(src: string, name: string): number {
  const re = new RegExp(`\\b(?:float|int|bool|vec2|vec3|vec4|sampler2D)\\s+${name}\\b\\s*[;=(,)]`)
  const m = re.exec(src)

  return m ? m.index + m[0].search(new RegExp(`\\b${name}\\b`)) : -1
}

/** Индекс первого вхождения имени как слова или -1. */
function firstUseAt(src: string, name: string): number {
  const m = new RegExp(`\\b${name}\\b`).exec(src)

  return m ? m.index : -1
}

describe('TerrainNearShadow: чанк', () => {
  it('зарегистрирован для #include', () => {
    expect(AppShaderChunk.terrainNearShadowFunctions).toBe(terrainNearShadowFunctions)
  })

  it('константы — из CPU-зеркала, литералы буквально', () => {
    expect(chunk).toContain(`#define TERRAIN_NEAR_SHADOW_STEPS ${NEAR_SHADOW_STEPS}`)
    expect(chunk).toContain(`#define TERRAIN_NEAR_SHADOW_BIAS_SLOPE ${NEAR_SHADOW_BIAS_SLOPE}`)
    // целая константа в float-выражении — ошибка GLSL ES; шаги — int для границы цикла
    expect(chunk).toContain('#define TERRAIN_NEAR_SHADOW_STEPS 16')
    expect(chunk).toContain('#define TERRAIN_NEAR_SHADOW_BIAS_SLOPE 0.05')
  })

  it('проекция и uv плитки: гномоническая, центр тексела, строка 0 — юг', () => {
    for (const line of [
      'float k = uBodyRadiusMeters / dot(d, uNearTileCenter);',
      'return vec2(dot(d, uNearTileEast), dot(d, uNearTileNorth)) * k;',
      'return xy / (uNearTileTexels * uNearTileTexelMeters) + 0.5;'
    ]) {
      expect(chunk).toContain(line)
    }
  })

  it('выборки плитки — только с явным LOD (в цикле с break производные не определены)', () => {
    expect(chunk).toContain('texture2DLodEXT(uNearTile, terrainNearTileUv(xy), 0.0).r')
    expect(chunk).not.toMatch(/texture2D\s*\(/)
    expect(chunk).not.toMatch(/\btexture\s*\(/)
    expect(chunk).not.toContain('fwidth')
    expect(chunk).not.toContain('dFdx')
  })

  it('краевой вес: 1 внутри 0.8·half, 0 на краю, по max(|x|, |y|)', () => {
    expect(chunk).toContain('float halfMeters = 0.5 * uNearTileTexels * uNearTileTexelMeters;')
    expect(chunk).toContain('return 1.0 - smoothstep(0.8 * halfMeters, halfMeters, max(abs(xy.x), abs(xy.y)));')
    // вес высоты уже включает силу ручки — второй раз не множится
    expect(chunk).toContain('vec2 xy = terrainNearTileXY(dir);')
    expect(chunk).toContain('return uNearTileWeight * (terrainNearCameraWeight(xy) * terrainNearEdgeWeight(xy));')
    expect(chunk).not.toContain('nearShadowStrength')
    expect(chunk).not.toContain('uNearShadowStrength')
    // задняя полусфера: проекция не определена — вес 0
    expect(chunk).toContain('if (dot(dir, uNearTileCenter) <= 0.0) return 0.0;')
  })

  it('вес камеры: круг вокруг подкамерной точки, как nearCameraWeight в CPU-зеркале', () => {
    expect(chunk).toContain('float terrainNearCameraWeight(vec2 xy) {')
    expect(chunk).toContain('return 1.0 - smoothstep(uNearCameraFadeMeters.x, uNearCameraFadeMeters.y, length(xy - uNearCameraXY));')
    expect(chunk.indexOf('float terrainNearCameraWeight(')).toBeLessThan(chunk.indexOf('float terrainNearShadowWeight('))
  })

  it('тело марша — построчно как nearShadowMarch в CPU-зеркале', () => {
    const lines = [
      'float se = dot(sunLocal, uNearTileEast);',
      'float sn = dot(sunLocal, uNearTileNorth);',
      'float horiz = length(vec2(se, sn));',
      // зенит: проекция солнца на базис ЦЕНТРА плитки
      'if (horiz < 1e-6) return 1.0;',
      'vec2 stepDir = vec2(se, sn) / horiz;',
      'float sinT = dot(sunLocal, dir);',
      'float tanT = sinT / max(sqrt(max(1.0 - sinT * sinT, 0.0)), 1e-6);',
      'float R = uBodyRadiusMeters;',
      'vec2 p0 = terrainNearTileXY(dir);',
      'float h0 = terrainNearTileHeight(p0);',
      'float bias = uNearTileTexelMeters * TERRAIN_NEAR_SHADOW_BIAS_SLOPE;',
      'float sMin = uNearTileTexelMeters;',
      'float sMax = max(uNearShadowMaxDistMeters, sMin * 2.0);',
      'float ratio = pow(sMax / sMin, 1.0 / float(TERRAIN_NEAR_SHADOW_STEPS - 1));',
      'for (int i = 0; i < TERRAIN_NEAR_SHADOW_STEPS; i++) {',
      // кривизна ПЛЮС: сфера уходит из-под прямой
      'float hRay = h0 + s * tanT + s * s / (2.0 * R);',
      'float pen = (terrainNearTileHeight(p0 + stepDir * s) - hRay - bias) / max(s * uShadowPenumbraTan, 1e-6);',
      'occl = max(occl, clamp(pen, 0.0, 1.0));',
      'if (occl >= 1.0) break;',
      's *= ratio;',
      'return 1.0 - occl;'
    ]
    let at = chunk.indexOf('float terrainNearShadowMarch(vec3 dir, vec3 sunLocal) {')
    expect(at).toBeGreaterThan(-1)

    for (const line of lines) {
      const next = chunk.indexOf(line, at)
      expect(next, line).toBeGreaterThan(at)
      at = next
    }
  })

  it('без раннего выхода по солнцу под горизонтом и без минуса кривизны', () => {
    expect(chunk).not.toMatch(/if\s*\(\s*sinT/)
    expect(chunk).not.toMatch(/if\s*\(\s*tanT/)
    expect(chunk).not.toContain('- s * s / (2.0 * R)')
    // единственный ранний return 1.0 — зенит
    expect(chunk.split('return 1.0;').length - 1).toBe(1)
  })

  it('без зарезервированных слов GLSL ES 3.00 в именах', () => {
    expect(chunk).not.toMatch(/\b(?:float|vec2|vec3)\s+(?:half|sample|input|output|filter)\b/)
  })
})

describe('TerrainShaderTemplate: сложение слоёв тени', () => {
  it('чанк включён под USE_TERRAIN_SHADOW, после дальнего марша', () => {
    const start = frag.indexOf('#ifdef USE_TERRAIN_SHADOW')
    const block = frag.slice(start, frag.indexOf('#endif', start))
    expect(block).toContain('#include <terrainNearShadowFunctions>')
    expect(block.indexOf('#include <terrainNearShadowFunctions>')).toBeGreaterThan(block.indexOf('#include <terrainShadowMarchFunctions>'))
  })

  it('порядок: дальний слой → ближний min → directGain', () => {
    const far = frag.indexOf(FAR_LINE)
    const gate = frag.indexOf(NEAR_GATE)
    const weight = frag.indexOf('float nearWeight = terrainNearShadowWeight(dirLocal);')
    const combine = frag.indexOf(NEAR_COMBINE)
    const mul = frag.indexOf('directGain *= terrainShadow;')
    expect(far).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(far)
    expect(weight).toBeGreaterThan(gate)
    expect(combine).toBeGreaterThan(weight)
    expect(mul).toBeGreaterThan(combine)
  })

  it('вес 0: строка дальнего слоя прежняя, ближний — только под однородной веткой по юниформу', () => {
    expect(frag.split(FAR_LINE).length - 1).toBe(1)
    expect(frag.split('terrainNearShadowMarch(').length - 1).toBe(1)
    expect(frag.split('terrainShadow = min(').length - 1).toBe(1)
    // CPU-зеркало сложения: при весе 0 ровно дальний слой
    for (const far of [0, 0.3, 1]) expect(combineTerrainShadow(far, 0, 0)).toBe(far)
    expect(combineTerrainShadow(0.7, 0.2, 1)).toBe(0.2)
  })

  // путь задаёт шаблон: у сферы слоя тени нет ни при каком дефайне
  const combos: [string, string, string[]][] = [
    ['рельеф', 'ничего', []],
    ['рельеф', 'тень', ['USE_TERRAIN_SHADOW']],
    ['сфера', 'ничего', []],
    ['сфера', 'тень', ['USE_TERRAIN_SHADOW']]
  ]

  const GLOBALS = [
    'uNearTile', 'uNearTileCenter', 'uNearTileEast', 'uNearTileNorth', 'uNearTileTexelMeters', 'uNearTileTexels',
    'uNearTileWeight', 'uNearShadowMaxDistMeters', 'uBodyRadiusMeters', 'uShadowPenumbraTan',
    'uNearCameraXY', 'uNearCameraFadeMeters', 'terrainNearCameraWeight',
    'terrainNearTileXY', 'terrainNearTileUv', 'terrainNearTileHeight', 'terrainNearEdgeWeight',
    'terrainNearShadowWeight', 'terrainNearShadowMarch', 'terrainShadowMarch'
  ]
  const MAIN_LOCALS = ['dirLocal', 'sunLocal', 'terrainShadow', 'NdotLraw', 'nearWeight', 'directGain']

  it.each(combos)('объявления до использования: %s, %s', (path, _name, defs) => {
    const terrain = path === 'рельеф'
    const source = terrain ? frag : SphereSurfaceShaderTemplate.fragmentShader
    const src = preprocessGlsl(AbstractShader.prepareSource(source), new Set(defs))
    const shadow = terrain && defs.includes('USE_TERRAIN_SHADOW')
    const both = shadow

    for (const name of GLOBALS) {
      const use = firstUseAt(src, name)
      if (!shadow) {
        expect(use, name).toBe(-1)
        continue
      }
      // первое вхождение — объявление, единственное
      expect(use, name).toBeGreaterThan(-1)
      expect(declarationAt(src, name), name).toBe(use)
    }

    const mainAt = src.indexOf('void main()')
    const main = src.slice(mainAt)
    expect(main.includes('terrainNearShadowMarch('), 'вызов марша').toBe(both)
    expect(main.includes('uNearTileWeight'), 'гейт').toBe(both)

    if (both) {
      for (const name of MAIN_LOCALS) {
        expect(declarationAt(main, name), name).toBe(firstUseAt(main, name))
      }
    }
  })
})
