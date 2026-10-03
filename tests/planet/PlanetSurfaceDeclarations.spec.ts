import { describe, expect, it } from 'vitest'
import { AbstractShader, ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { normalizeGlsl, preprocessGlsl } from '../helpers/glsl'

/** Встроенные three: объявляются ради видимости, читаются (или нет) по чанкам three. */
const THREE_BUILTINS = new Set([
  'modelMatrix',
  'modelViewMatrix',
  'projectionMatrix',
  'viewMatrix',
  'normalMatrix',
  'cameraPosition',
  'isOrthographic',
  'logDepthBufFC',
  'vFragDepth',
  'vIsPerspective'
])

/** Все подмножества списка; элемент-массив — неразрывная группа дефайнов. */
function subsets(groups: readonly (readonly string[])[]): string[][] {
  const out: string[][] = []
  for (let mask = 0; mask < 1 << groups.length; mask++) {
    out.push(groups.filter((_g, i) => mask & (1 << i)).flat())
  }

  return out
}

const COMMON: readonly (readonly string[])[] = [
  ['USE_RING'],
  ['USE_REGOLITH'],
  ['USE_LIGHT_TINT'],
  ['USE_NIGHT'],
  ['USE_CLOUD'],
  ['USE_SUN_TINT', 'USE_SKY_AMBIENT']
]

const sphereCombos: string[][] = subsets([...COMMON, ['USE_SPECULAR'], ['USE_GIANT_DETAIL']])

// Импликации TerrainMaterial.updatePath: CAVITY/MACRO/FROST требуют SLOPE,
// WATER_EDGE — MACRO, GLINT — DETAIL, CLOUD_SHADOW — CLOUD
const TERRAIN_REQUIRES: Record<string, string> = {
  USE_CAVITY: 'USE_SLOPE',
  USE_TERRAIN_MACRO_DETAIL: 'USE_SLOPE',
  USE_TERRAIN_FROST: 'USE_SLOPE',
  USE_WATER_EDGE: 'USE_TERRAIN_MACRO_DETAIL',
  USE_TERRAIN_GLINT: 'USE_TERRAIN_DETAIL',
  USE_CLOUD_SHADOW: 'USE_CLOUD'
}

// Общие дефайны у рельефа — разом все или ни одного (кроме USE_CLOUD — вход импликации):
// объединение по подмножеству сочетаний строже полного перебора, а перебор в 32 раза дешевле
const TERRAIN_COMMON_SETS: string[][] = [[], COMMON.flat().filter((name) => name !== 'USE_CLOUD')]

const terrainCombos: string[][] = subsets([
  ['USE_CLOUD'],
  ['USE_SLOPE'],
  ['USE_TERRAIN_DETAIL'],
  ['USE_CAVITY'],
  ['USE_TERRAIN_MACRO_DETAIL'],
  ['USE_WATER_EDGE'],
  ['USE_CLOUD_SHADOW'],
  ['USE_TERRAIN_SHADOW'],
  ['USE_TERRAIN_GLINT'],
  ['USE_TERRAIN_FROST']
])
  .filter((combo) => combo.every((name) => !TERRAIN_REQUIRES[name] || combo.includes(TERRAIN_REQUIRES[name])))
  .flatMap((combo) => TERRAIN_COMMON_SETS.map((common) => [...common, ...combo]))

const DECLARATION = /^(?:uniform|varying)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;$/

/** Имена, объявленные uniform/varying хотя бы при одном сочетании, и имена, встреченные вне строк объявлений. */
function declaredAndRead(source: string, combos: readonly string[][]): { declared: Set<string>; read: Set<string> } {
  const prepared = AbstractShader.prepareSource(source)
  const declared = new Set<string>()
  const read = new Set<string>()

  for (const combo of combos) {
    for (const line of normalizeGlsl(preprocessGlsl(prepared, new Set(combo))).split('\n')) {
      const decl = DECLARATION.exec(line)
      if (decl) {
        declared.add(decl[1])
        continue
      }
      for (const name of line.match(/\b[A-Za-z_]\w*\b/g) ?? []) read.add(name)
    }
  }

  return { declared, read }
}

const cases: [string, ShaderProps, string[][]][] = [
  ['сфера', SphereSurfaceShaderTemplate, sphereCombos],
  ['рельеф', TerrainShaderTemplate, terrainCombos]
]

describe.each(cases)('%s: каждый объявленный uniform/varying читается своим путём', (_path, template, combos) => {
  for (const stage of ['vertexShader', 'fragmentShader'] as const) {
    it(stage, () => {
      const { declared, read } = declaredAndRead(template[stage], combos)
      const unread = [...declared].filter((name) => !THREE_BUILTINS.has(name) && !read.has(name)).sort()

      expect(declared.size).toBeGreaterThan(0)
      expect(unread).toEqual([])
    })
  }
})

describe('объявления чужого пути', () => {
  const sphere = {
    vert: declaredAndRead(SphereSurfaceShaderTemplate.vertexShader, sphereCombos),
    frag: declaredAndRead(SphereSurfaceShaderTemplate.fragmentShader, sphereCombos)
  }
  const terrain = {
    vert: declaredAndRead(TerrainShaderTemplate.vertexShader, terrainCombos),
    frag: declaredAndRead(TerrainShaderTemplate.fragmentShader, terrainCombos)
  }

  it('specularMap и vUv — только у сферы', () => {
    expect(sphere.frag.declared).toContain('specularMap')
    expect(sphere.frag.declared).toContain('vUv')
    expect(sphere.vert.declared).toContain('vUv')
    for (const stage of [terrain.vert, terrain.frag]) {
      expect(stage.declared).not.toContain('specularMap')
      expect(stage.declared).not.toContain('vUv')
      expect(stage.read).not.toContain('specularMap')
      expect(stage.read).not.toContain('vUv')
    }
  })

  it('bumpMap, bumpScale, uCavityStrength, blinnPhongGlint, wetEdge, glintEdge, terrainRoughness — только у рельефа', () => {
    for (const name of ['bumpMap', 'bumpScale', 'uCavityStrength']) {
      expect(terrain.frag.declared).toContain(name)
      expect(sphere.frag.declared).not.toContain(name)
    }
    for (const name of ['bumpMap', 'bumpScale', 'uCavityStrength', 'blinnPhongGlint', 'wetEdge', 'glintEdge', 'terrainRoughness']) {
      expect(terrain.frag.read).toContain(name)
      expect(sphere.frag.read).not.toContain(name)
    }
  })

  it('дефолты юниформов шаблона — у своего пути', () => {
    expect(SphereSurfaceShaderTemplate.uniforms).toHaveProperty('specularMap')
    expect(TerrainShaderTemplate.uniforms).not.toHaveProperty('specularMap')
    for (const name of ['bumpMap', 'bumpScale', 'uCavityStrength']) {
      expect(TerrainShaderTemplate.uniforms).toHaveProperty(name)
      expect(SphereSurfaceShaderTemplate.uniforms).not.toHaveProperty(name)
    }
    expect(TerrainShaderTemplate.uniforms.bumpScale.value).toBe(0)
  })
})
