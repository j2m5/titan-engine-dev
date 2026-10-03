import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Texture, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { AbstractShader, type ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { SphereSurfaceShader } from '@/core/materials/shaders/SphereSurfaceShader'
import { TerrainShader } from '@/core/materials/shaders/TerrainShader'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { heightPathOf } from '@/core/terrain/heightPath'
import { normalizeGlsl, preprocessGlsl, withoutComments } from '../helpers/glsl'
import {
  collectParityStates,
  resetRegistries,
  seedFull,
  seedPlaceholderKeys,
  serializeField,
  serializeUniforms,
  tintRegistryFor,
  withoutShader,
  type CollectedState,
  type MakeParityMaterial,
  type ParityPath,
  type ParityState,
  type SerializedField
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

// снимок пишет старый материал, сверяются материалы путей
const makeLegacy: MakeParityMaterial = (actor, path, registry) =>
  new PlanetMaterial(actor, registry, { terrainPatches: path === 'terrain' })
const makeMaterial: MakeParityMaterial = (actor, path, registry) =>
  path === 'terrain' ? new TerrainMaterial(actor, registry) : new SphereSurfaceMaterial(actor, registry)

const templateOf = (p: ParityPath): ShaderProps => (p === 'terrain' ? TerrainShaderTemplate : SphereSurfaceShaderTemplate)

// Объявлены в шаблоне, но ставит их не шейдер: встроенные three и юниформы материала
const BUILTIN_UNIFORMS = ['normalMatrix', 'logDepthBufFC']
const MATERIAL_UNIFORMS = [
  'uLightColor',
  'uDetailTintNorm',
  'uSteepTintNorm',
  'uSteepNorMap',
  'uSteepArmMap',
  'uSteepDiffMap',
  'uSteepGate',
  'uSteepMask',
  'uSteepTint',
  'uFrostStrength',
  'uFrostLine',
  'uFrostSlopeMax',
  'uFrostColor',
  'uMidbandShade'
]
const NOT_SHADER_KEYS = new Set([...BUILTIN_UNIFORMS, ...MATERIAL_UNIFORMS])

/** Раскрытый код шаблона: вершинник и фрагментник, без комментариев. */
const preparedCode = (template: ShaderProps): string =>
  withoutComments(AbstractShader.prepareSource(template.vertexShader) + '\n' + AbstractShader.prepareSource(template.fragmentShader))

// одно имя на объявление: `uniform float a, b;` регэксп ниже прочёл бы только a (страж — в тесте)
const UNIFORM_NAME = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)/g
const COMMA_UNIFORM = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+\w+\s*(?:\[[^\]]*\])?\s*,/

/** Имена `uniform` в коде (все ветки дефайнов). */
const uniformNamesIn = (code: string): string[] => [...new Set([...code.matchAll(UNIFORM_NAME)].map((m) => m[1]))].sort()

describe.runIf(SNAPSHOT_RUN)('снимок', () => {
  it('пишет snapshot.json и legacyPrepared.json', () => {
    const states = collectParityStates(makeLegacy)
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

    it('объявлений юниформов через запятую нет — ни в замороженном, ни в шаблонах путей', () => {
      const sources = {
        frozen: withoutComments(frozen.vertexShader + '\n' + frozen.fragmentShader),
        sphere: preparedCode(SphereSurfaceShaderTemplate),
        terrain: preparedCode(TerrainShaderTemplate)
      }
      for (const [name, code] of Object.entries(sources)) expect(code, name).not.toMatch(COMMA_UNIFORM)
      // страж сам ловит запятую
      expect('uniform float a, b;').toMatch(COMMA_UNIFORM)
      expect('uniform highp vec2 a[2] , b;').toMatch(COMMA_UNIFORM)
    })
  })

  // Разрешённые расхождения — только во фрагментнике (вершинник lightPosition читает);
  // name — объявленный идентификатор: во фрагментнике нового шаблона его быть не должно
  const ALLOWED_REMOVED = [{ name: 'lightPosition', line: /^uniform vec3 lightPosition;$/ }]

  const legacyUnder = (stage: Stage, defines: Set<string>): string => {
    const out = frozenUnder(stage, defines)
    if (stage === 'vertexShader') return out

    return out
      .split('\n')
      .filter((line) => !ALLOWED_REMOVED.some(({ line: re }) => re.test(line)))
      .join('\n')
  }

  /** Раскрытый шейдер пути против замороженного на дефайнах состояния (и дополнительных наборах). */
  const expectPathShaderParity = (s: ParityState, prepared: (stage: Stage) => string): void => {
    for (const extra of extrasOf(s)) {
      // старый: дефайны снимка (у рельефа там и USE_TERRAIN_UV); новый — те же без него:
      // шаблону пути дефайн не нужен
      const defines = definesOf(s, extra)
      expect(defines.has('USE_TERRAIN_UV')).toBe(s.path === 'terrain')
      const own = new Set([...defines].filter((d) => d !== 'USE_TERRAIN_UV'))
      for (const stage of STAGES) {
        const got = normalizeGlsl(preprocessGlsl(prepared(stage), own))
        expect(got, `${stage} +[${extra.join(' ')}]`).toBe(legacyUnder(stage, defines))
      }
      // снятое объявление не должно оставить обращений (GLSL в CI не компилируется)
      const fragment = withoutComments(preprocessGlsl(prepared('fragmentShader'), own))
      for (const { name } of ALLOWED_REMOVED) {
        expect(fragment, `${name} во фрагментнике +[${extra.join(' ')}]`).not.toMatch(new RegExp(`\\b${name}\\b`))
      }
    }
  }

  describe('паритет шейдера материала против замороженного', () => {
    it('материал пути держит шейдер своего шаблона', () => {
      for (const s of states) {
        const f = freshOf(s)
        for (const stage of STAGES) {
          expect(f.shader[stage], `${s.actorId} ${s.state} ${stage}`).toBe(AbstractShader.prepareSource(templateOf(s.path)[stage]))
        }
      }
    })

    for (const s of states) {
      it(`${s.actorId} ${s.state}`, () => {
        const f = freshOf(s)
        expectPathShaderParity(s, (stage) => f.shader[stage])
      })
    }
  })

  describe('паритет шаблона пути против замороженного', () => {
    const preparedOf = (p: ParityPath, stage: Stage): string => AbstractShader.prepareSource(templateOf(p)[stage])

    it('USE_TERRAIN_UV шаблоны не ветвит — ни сам шаблон, ни подключённые чанки', () => {
      for (const p of ['sphere', 'terrain'] as const) {
        for (const stage of STAGES) expect(preparedOf(p, stage), `${p} ${stage}`).not.toMatch(/USE_TERRAIN_UV/)
      }
    })

    it('в каждом шаблоне нет кода чужого пути', () => {
      const code = (p: ParityPath): string => withoutComments(preparedOf(p, 'vertexShader') + '\n' + preparedOf(p, 'fragmentShader'))
      for (const name of ['patchCenter', 'morphDelta', 'vDetailPos']) expect(code('sphere')).not.toContain(name)
      expect(code('terrain')).not.toMatch(/vUv\s*=\s*uv/)
      expect(code('terrain')).not.toContain('applyGiantDetail')
    })

    for (const s of states) {
      it(`${s.actorId} ${s.state}`, () => {
        expectPathShaderParity(s, (stage) => preparedOf(s.path, stage))
      })
    }
  })

  describe('паритет юниформов, дефайнов и полей материала против снимка', () => {
    // Атрибуты патча: их дефолты держит только материал рельефа
    const PATCH_ATTRIBUTES = ['patchCenter', 'midShade', 'morphDelta', 'patchMorph', 'midShadeParent', 'midTiltParent']

    // У старого USE_TERRAIN_UV стоял на патчах всегда; материалу рельефа он не нужен
    const definesWithoutUv = (defines: ParityState['defines']): ParityState['defines'] =>
      Object.fromEntries(Object.entries(defines).filter(([k]) => k !== 'USE_TERRAIN_UV'))

    // Ключи материала = юниформы, объявленные шаблоном его пути (кроме встроенных three):
    // ключи шейдера пути плюс юниформы материала, которые этот шаблон читает
    const expectedKeysOf = (p: ParityPath): string[] =>
      uniformNamesIn(preparedCode(templateOf(p))).filter((k) => !BUILTIN_UNIFORMS.includes(k))

    // Юниформы чужого пути отсутствуют (разрешено); каждый свой ключ равен снимку
    const expectUniformParity = (got: ParityState['uniforms'], snapshot: ParityState['uniforms'], p: ParityPath): void => {
      expect(Object.keys(got).sort()).toEqual(expectedKeysOf(p))
      for (const key of Object.keys(got)) expect(key in snapshot, key).toBe(true)
      expect(got).toStrictEqual(Object.fromEntries(Object.keys(got).map((k) => [k, snapshot[k]])))
    }

    // Сфера: поля как у старого, кроме дефолтов атрибутов патча
    const expectFieldParity = (got: ParityState['material'], snapshot: ParityState['material'], p: ParityPath): void => {
      if (p === 'terrain') {
        expect(got).toStrictEqual(snapshot)

        return
      }
      const attributes = got.defaultAttributeValues as Record<string, SerializedField>
      for (const name of PATCH_ATTRIBUTES) expect(attributes, name).not.toHaveProperty(name)
      const legacyAttributes = Object.fromEntries(
        Object.entries(snapshot.defaultAttributeValues as Record<string, SerializedField>).filter(([k]) => !PATCH_ATTRIBUTES.includes(k))
      )
      expect(got).toStrictEqual({ ...snapshot, defaultAttributeValues: legacyAttributes })
    }

    it('набор состояний совпадает со снимком', () => {
      const key = (x: ParityState): string => `${x.actorId} ${x.state}`
      expect(fresh.map(key)).toEqual(states.map(key))
    })

    it('юниформы материала по путям: сфере нужен только цвет света, рельефу — все', () => {
      expect(MATERIAL_UNIFORMS.filter((k) => expectedKeysOf('sphere').includes(k))).toEqual(['uLightColor'])
      expect(MATERIAL_UNIFORMS.filter((k) => !expectedKeysOf('terrain').includes(k))).toEqual([])
    })

    for (const s of states) {
      it(`${s.actorId} ${s.state}`, () => {
        const f = freshOf(s)
        expect(f.defines).toStrictEqual(definesWithoutUv(s.defines))
        expectUniformParity(f.uniforms, s.uniforms, s.path)
        expectFieldParity(f.material, s.material, s.path)
      })

      it(`${s.actorId} ${s.state} после resetMaterial`, () => {
        const f = freshOf(s)
        expect(f.reset.defines).toStrictEqual(definesWithoutUv(s.reset.defines))
        expectUniformParity(f.reset.uniforms, s.reset.uniforms, s.path)
        expectFieldParity(f.reset.material, s.reset.material, s.path)
      })
    }
  })
})

describe.skipIf(SNAPSHOT_RUN)('паритет юниформов шейдера', () => {
  const category4Actors = (): Actor[] =>
    Actor.where({ categoryId: 4 })
      .all()
      .sort((a, b) => (a.getAttribute('id') as number) - (b.getAttribute('id') as number))

  const pick = <T>(record: Record<string, T>, keys: string[]): Record<string, T> =>
    Object.fromEntries(keys.filter((k) => k in record).map((k) => [k, record[k]]))

  /** Имена `uniform` в раскрытом шаблоне (все ветки дефайнов) без юниформов не-шейдера. */
  const keysDeclaredIn = (template: ShaderProps): string[] => uniformNamesIn(preparedCode(template)).filter((k) => !NOT_SHADER_KEYS.has(k))

  // Контракт «шаблон ↔ рантайм»: каждому дефолту шаблона шейдер ставит значение
  const defaultsCovered = (template: ShaderProps, keys: string[]): void => {
    const missing = Object.keys(template.uniforms).filter((k) => !NOT_SHADER_KEYS.has(k) && !keys.includes(k))
    expect(missing).toEqual([])
  }

  const seeds: Record<'bare' | 'full', (actor: Actor) => void> = {
    bare: (actor) => seedPlaceholderKeys(actor),
    full: (actor) => {
      seedPlaceholderKeys(actor)
      seedFull(actor, false)
    }
  }

  for (const actor of category4Actors()) {
    for (const seed of ['bare', 'full'] as const) {
      it(`${actor.getAttribute('id')} ${seed}`, () => {
        resetRegistries()
        seeds[seed](actor)
        try {
          const old = new PlanetShader(actor).uniforms
          const sphere = new SphereSurfaceShader(actor).uniforms
          expect(serializeUniforms(sphere)).toEqual(pick(serializeUniforms(old), Object.keys(sphere)))
          expect(Object.keys(sphere).sort()).toEqual(keysDeclaredIn(SphereSurfaceShaderTemplate))
          defaultsCovered(SphereSurfaceShaderTemplate, Object.keys(sphere))
          if (heightPathOf(actor)) {
            const terrain = new TerrainShader(actor).uniforms
            expect(serializeUniforms(terrain)).toEqual(pick(serializeUniforms(old), Object.keys(terrain)))
            expect(Object.keys(terrain).sort()).toEqual(keysDeclaredIn(TerrainShaderTemplate))
            defaultsCovered(TerrainShaderTemplate, Object.keys(terrain))
            // объединение ключей двух путей = ключи старого шейдера
            expect([...new Set([...Object.keys(sphere), ...Object.keys(terrain)])].sort()).toEqual(Object.keys(old).sort())
          }
        } finally {
          resetRegistries()
        }
      })
    }
  }

  it('дефайны шейдера: общие USE_RING и USE_REGOLITH, как у старого', () => {
    for (const actor of category4Actors()) {
      resetRegistries()
      seedPlaceholderKeys(actor)
      try {
        const old = new PlanetShader(actor).defines
        expect(new SphereSurfaceShader(actor).defines, `${actor.getAttribute('id')}`).toStrictEqual(old)
        if (heightPathOf(actor)) expect(new TerrainShader(actor).defines, `${actor.getAttribute('id')}`).toStrictEqual(old)
      } finally {
        resetRegistries()
      }
    }
  })
})
