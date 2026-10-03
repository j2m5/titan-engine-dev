import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Texture, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { normalizeGlsl, preprocessGlsl } from '../helpers/glsl'
import {
  collectParityStates,
  serializeField,
  serializeUniforms,
  tintRegistryFor,
  withoutShader,
  type CollectedState,
  type MakeParityMaterial,
  type ParityState
} from '../fixtures/planetMaterialParity/collectStates'

/**
 * Паритет материала планет на время разделения на сферу и рельеф: снимок
 * старого материала (дефайны, юниформы, поля материала — живые и после
 * resetMaterial — по всем телам категории 4) и его шейдер, замороженный уже
 * раскрытым (`#include` и чанки three подставлены). Новый код обязан совпасть
 * с ними побайтно. Снимок пересобирается только `npm run parity:snapshot`.
 */

const SNAPSHOT_PATH = 'tests/fixtures/planetMaterialParity/snapshot.json'
const PREPARED_PATH = 'tests/fixtures/planetMaterialParity/legacyPrepared.json'
const SNAPSHOT_RUN = import.meta.env.MODE === 'parity-snapshot'

type Stage = 'vertexShader' | 'fragmentShader'
type PreparedShader = Record<Stage, string>
const STAGES: readonly Stage[] = ['vertexShader', 'fragmentShader']

const makeMaterial: MakeParityMaterial = (actor, path, registry) =>
  new PlanetMaterial(actor, registry, { terrainPatches: path === 'terrain' })

describe.runIf(SNAPSHOT_RUN)('снимок', () => {
  it('пишет snapshot.json и legacyPrepared.json', () => {
    const states = collectParityStates(makeMaterial)
    const prepared: PreparedShader = states[0].shader
    // старый материал — один шаблон на все состояния: иначе замороженный шейдер был бы неоднозначен
    for (const s of states) expect(s.shader, `${s.actorId} ${s.state}`).toStrictEqual(prepared)

    writeFileSync(SNAPSHOT_PATH, JSON.stringify(states.map(withoutShader), null, 1) + '\n')
    // концы строк исходников зависят от autocrlf рабочей копии — в фикстуру только \n
    const lf = (src: string): string => src.replace(/\r\n/g, '\n')
    writeFileSync(PREPARED_PATH, JSON.stringify({ vertexShader: lf(prepared.vertexShader), fragmentShader: lf(prepared.fragmentShader) }, null, 1) + '\n')
  })
})

describe.skipIf(SNAPSHOT_RUN)('паритет материала планет', () => {
  const states = existsSync(SNAPSHOT_PATH) ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as ParityState[]) : []
  const frozen = existsSync(PREPARED_PATH)
    ? (JSON.parse(readFileSync(PREPARED_PATH, 'utf8')) as PreparedShader)
    : { vertexShader: '', fragmentShader: '' }

  let fresh: CollectedState[] = []
  beforeAll(() => {
    fresh = collectParityStates(makeMaterial)
  })
  const freshOf = (s: ParityState): CollectedState => {
    const f = fresh.find((x) => x.actorId === s.actorId && x.state === s.state)
    if (!f) throw new Error(`нет свежего состояния ${s.actorId} ${s.state}`)

    return f
  }

  const definesOf = (s: ParityState, extra: string[] = []): Set<string> =>
    new Set([...Object.keys(s.defines).filter((k) => s.defines[k] !== false), ...extra])

  // Ветки, которых дефайны снимка не открывают: иней не включён ни у одного
  // тела БД, тинт без атмосферы не ставится. Сверяются поверх набора состояния.
  const TINT = ['USE_SUN_TINT', 'USE_SKY_AMBIENT']
  const FROST = ['USE_TERRAIN_FROST']
  const extrasOf = (s: ParityState): string[][] =>
    s.path === 'terrain' ? [[], TINT, FROST, [...TINT, ...FROST]] : [[], TINT]

  const frozenCache = new Map<string, string>()
  const frozenUnder = (stage: Stage, defines: Set<string>): string => {
    const key = `${stage}|${[...defines].sort().join(',')}`
    let out = frozenCache.get(key)
    if (out === undefined) {
      out = normalizeGlsl(preprocessGlsl(frozen[stage], defines))
      frozenCache.set(key, out)
    }

    return out
  }

  describe('serializeUniforms / serializeField', () => {
    it('неизвестный тип значения — ошибка с именем ключа, а не тихий пропуск', () => {
      expect(() => serializeUniforms({ uStrange: { value: { a: 1 } } })).toThrow(/uStrange/)
      expect(() => serializeUniforms({ uList: { value: [1, 'x'] } })).toThrow(/uList\[1\]/)
      expect(() => serializeUniforms({ uInf: { value: Infinity } })).toThrow(/uInf/)
      expect(() => serializeField({ a: () => 1 }, 'ext')).toThrow(/ext\.a/)
      expect(() => serializeField(new Map(), 'm')).toThrow(/m/)
    })

    it('null и undefined различимы, -0 сведён к 0, векторы и текстуры в плоской форме', () => {
      const texture = new Texture()
      texture.name = 'a.png'
      expect(
        serializeUniforms({ a: { value: null }, b: { value: undefined }, c: { value: -0 }, d: { value: new Vector3(1, 2, 3) }, e: { value: texture } })
      ).toStrictEqual({
        a: null,
        b: { undefined: true },
        c: 0,
        d: [1, 2, 3],
        e: { texture: 'a.png' }
      })
      expect(serializeField({ b: [0, -0], a: undefined }, 'x')).toStrictEqual({ a: { undefined: true }, b: [0, 0] })
    })
  })

  describe('снимок покрывает базу', () => {
    const planets = Actor.where({ categoryId: 4 }).all()
    const sortedIds = (actors: Actor[]): number[] => actors.map((a) => a.getAttribute('id') as number).sort((a, b) => a - b)
    const all = sortedIds(planets)
    const terrain = sortedIds(planets.filter((a) => a.resources.where('resourceType', 'height').first() !== undefined))
    const tinted = sortedIds(planets.filter((a) => tintRegistryFor(a) !== undefined))
    const tintedTerrain = tinted.filter((id) => terrain.includes(id))

    it('все тела категории 4; рельефные — у тел с картой высот; *-tint — у тел с атмосферой', () => {
      const ids = (name: ParityState['state']): number[] =>
        states
          .filter((s) => s.state === name)
          .map((s) => s.actorId)
          .sort((a, b) => a - b)

      expect(all.length).toBeGreaterThan(0)
      expect(tinted.length).toBeGreaterThan(0)
      expect(ids('sphere-bare')).toEqual(all)
      expect(ids('sphere-full')).toEqual(all)
      expect(ids('sphere-full-tint')).toEqual(tinted)
      expect(ids('terrain-bare')).toEqual(terrain)
      expect(ids('terrain-full')).toEqual(terrain)
      expect(ids('terrain-full-tint')).toEqual(tintedTerrain)
      expect(states).toHaveLength(2 * all.length + tinted.length + 2 * terrain.length + tintedTerrain.length)
    })

    it('тинт-состояния действительно несут тинт от материала, а не только от дополнительных наборов', () => {
      for (const s of states.filter((x) => x.state.endsWith('-tint'))) {
        expect(s.defines.USE_SUN_TINT, `${s.actorId} ${s.state}`).toBe('1')
        expect(s.defines.USE_SKY_AMBIENT, `${s.actorId} ${s.state}`).toBe('1')
        expect((s.uniforms.uAtmoTransmittance as { texture: string }).texture).toMatch(/^lut\//)
        expect(s.reset.defines.USE_SUN_TINT).toBeUndefined()
      }
    })
  })

  describe('замороженный шейдер', () => {
    it('раскрыт: директив #include в нём нет', () => {
      for (const stage of STAGES) {
        expect(frozen[stage].length, stage).toBeGreaterThan(1000)
        expect(frozen[stage], stage).not.toMatch(/#include\s*</)
      }
    })
  })

  describe('паритет шейдера материала против замороженного', () => {
    for (const s of states) {
      it(`${s.actorId} ${s.state}`, () => {
        const f = freshOf(s)
        for (const extra of extrasOf(s)) {
          const defines = definesOf(s, extra)
          for (const stage of STAGES) {
            const got = normalizeGlsl(preprocessGlsl(f.shader[stage], defines))
            expect(got, `${stage} +[${extra.join(' ')}]`).toBe(frozenUnder(stage, defines))
          }
        }
      })
    }
  })

  describe('паритет юниформов, дефайнов и полей материала против снимка', () => {
    it('набор состояний совпадает со снимком', () => {
      const key = (x: ParityState): string => `${x.actorId} ${x.state}`
      expect(fresh.map(key)).toEqual(states.map(key))
    })

    for (const s of states) {
      it(`${s.actorId} ${s.state}`, () => {
        const f = freshOf(s)
        expect(f.defines).toStrictEqual(s.defines)
        expect(f.uniforms).toStrictEqual(s.uniforms)
        expect(f.material).toStrictEqual(s.material)
      })

      it(`${s.actorId} ${s.state} после resetMaterial`, () => {
        const f = freshOf(s)
        expect(f.reset.defines).toStrictEqual(s.reset.defines)
        expect(f.reset.uniforms).toStrictEqual(s.reset.uniforms)
        expect(f.reset.material).toStrictEqual(s.reset.material)
      })
    }
  })
})
