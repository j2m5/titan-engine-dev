import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Texture, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { normalizeGlsl, preprocessGlsl } from '../helpers/glsl'
import { collectParityStates, serializeUniforms, type ParityState } from '../fixtures/planetMaterialParity/collectStates'
import { LegacyPlanetShaderTemplate } from '../fixtures/planetMaterialParity/legacyPlanetShaderTemplate'

/**
 * Паритет материала планет на время разделения на сферу и рельеф: снимок
 * старого материала (дефайны + юниформы по всем телам категории 4) и
 * замороженный шаблон. Новый код обязан совпасть с ними побайтно.
 * Снимок пересобирается только `npm run parity:snapshot`.
 */

const SNAPSHOT_PATH = 'tests/fixtures/planetMaterialParity/snapshot.json'
const SNAPSHOT_RUN = import.meta.env.MODE === 'parity-snapshot'

const makeLegacyMaterial = (actor: Actor, path: 'sphere' | 'terrain'): PlanetMaterial =>
  new PlanetMaterial(actor, undefined, { terrainPatches: path === 'terrain' })

describe.runIf(SNAPSHOT_RUN)('снимок', () => {
  it('пишет snapshot.json', () => {
    const states = collectParityStates(makeLegacyMaterial)
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(states, null, 1) + '\n')
    expect(states.length).toBeGreaterThan(0)
  })
})

describe.skipIf(SNAPSHOT_RUN)('паритет материала планет', () => {
  const states = existsSync(SNAPSHOT_PATH) ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as ParityState[]) : []

  const definesOf = (s: ParityState, extra: string[] = []): Set<string> =>
    new Set([...Object.keys(s.defines).filter((k) => s.defines[k] !== false), ...extra])

  describe('serializeUniforms', () => {
    it('неизвестный тип значения — ошибка с именем ключа, а не тихий пропуск', () => {
      expect(() => serializeUniforms({ uStrange: { value: { a: 1 } } })).toThrow(/uStrange/)
      expect(() => serializeUniforms({ uList: { value: [1, 'x'] } })).toThrow(/uList\[1\]/)
      expect(() => serializeUniforms({ uInf: { value: Infinity } })).toThrow(/uInf/)
    })

    it('null и undefined различимы, -0 сведён к 0, векторы и текстуры в плоской форме', () => {
      const texture = new Texture()
      texture.name = 'a.png'
      expect(serializeUniforms({ a: { value: null }, b: { value: undefined }, c: { value: -0 }, d: { value: new Vector3(1, 2, 3) }, e: { value: texture } })).toStrictEqual({
        a: null,
        b: { undefined: true },
        c: 0,
        d: [1, 2, 3],
        e: { texture: 'a.png' }
      })
    })
  })

  describe('снимок покрывает базу', () => {
    const planets = Actor.where({ categoryId: 4 }).all()
    const withHeight = planets.filter((a) => a.resources.where('resourceType', 'height').first() !== undefined)

    it('все тела категории 4 — оба сферных состояния, тела с картой высот — оба рельефных', () => {
      const ids = (name: ParityState['state']): number[] =>
        states
          .filter((s) => s.state === name)
          .map((s) => s.actorId)
          .sort((a, b) => a - b)
      const all = planets.map((a) => a.getAttribute('id') as number).sort((a, b) => a - b)
      const terrain = withHeight.map((a) => a.getAttribute('id') as number).sort((a, b) => a - b)

      expect(planets.length).toBeGreaterThan(0)
      expect(ids('sphere-bare')).toEqual(all)
      expect(ids('sphere-full')).toEqual(all)
      expect(ids('terrain-bare')).toEqual(terrain)
      expect(ids('terrain-full')).toEqual(terrain)
      expect(states).toHaveLength(2 * all.length + 2 * terrain.length)
    })
  })

  // Дефайны, которых снимок не видит: тинт ставит реестр атмосфер (в сборе его
  // нет), иней не включён ни у одного тела БД. Ветки шаблона сверяются и с ними.
  const runtimeExtras = (s: ParityState): string[][] => {
    const sets: string[][] = [[], ['USE_SUN_TINT', 'USE_SKY_AMBIENT']]
    if (s.defines.USE_TERRAIN_UV && s.defines.USE_SLOPE) sets.push(['USE_TERRAIN_FROST'])

    return sets
  }

  describe('паритет шейдера: старый шаблон', () => {
    for (const s of states) {
      it(`${s.actorId} ${s.state}`, () => {
        const legacy = LegacyPlanetShaderTemplate
        const current = PlanetShaderTemplate
        for (const extra of runtimeExtras(s)) {
          for (const stage of ['vertexShader', 'fragmentShader'] as const) {
            const want = normalizeGlsl(preprocessGlsl(AbstractShader.prepareSource(legacy[stage]), definesOf(s, extra)))
            const got = normalizeGlsl(preprocessGlsl(AbstractShader.prepareSource(current[stage]), definesOf(s, extra)))
            expect(got, `${stage} +[${extra.join(' ')}]`).toBe(want)
          }
        }
      })
    }
  })

  describe('паритет юниформов и дефайнов: текущий материал против снимка', () => {
    const fresh = collectParityStates(makeLegacyMaterial)

    it('набор состояний совпадает со снимком', () => {
      const key = (x: ParityState): string => `${x.actorId} ${x.state}`
      expect(fresh.map(key)).toEqual(states.map(key))
    })

    for (const s of states) {
      it(`${s.actorId} ${s.state}`, () => {
        const f = fresh.find((x) => x.actorId === s.actorId && x.state === s.state)
        expect(f).toBeDefined()
        expect(f!.defines).toStrictEqual(s.defines)
        expect(f!.uniforms).toStrictEqual(s.uniforms)
      })
    }
  })
})
