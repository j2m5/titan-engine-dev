import { WebGLRenderer } from 'three'
import { RenderingObjects } from '@storage/database'
import { Actor } from '@/core/models/Actor'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import {
  AtmosphereConfig,
  EARTH_SOLAR,
  EMPTY_LAYER,
  expLayer,
  tintSolarIrradiance
} from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { lightColorOf, resolveLightTint } from '@/core/helpers/lightSource'

/**
 * Цвет солнечного излучения атмосферы выводится из звезды по тому же правилу,
 * что и прямой свет на поверхности (`lightColorOf`): ручная окраска в данных
 * (была у Halcyra, Nivalis, Thalorn, Isvara) снята, в данных у всех
 * `EARTH_SOLAR`. Звёзды без `lightTint` дают ровно белый множитель —
 * их атмосферы бит-в-бит прежние.
 */

const { generateSpy } = vi.hoisted(() => ({
  generateSpy: vi.fn((_config: AtmosphereConfig) => ({ transmittance: null, scattering: null, irradiance: null }))
}))

vi.mock('@/core/renderables/Atmosphere/AtmosphereLUTGenerator', () => ({
  AtmosphereLUTGenerator: class {
    public generate(config: AtmosphereConfig): { transmittance: null; scattering: null; irradiance: null } {
      return generateSpy(config)
    }
    public dispose(): void {}
  }
}))

function stubConfig(): AtmosphereConfig {
  return {
    solarIrradiance: [...EARTH_SOLAR],
    sunAngularRadius: 0.004,
    bottomRadius: 3390,
    topRadius: 3470,
    rayleighDensity: [EMPTY_LAYER, expLayer(10.859)],
    rayleighScattering: [1.21533e-4, 2.83996e-4, 6.93338e-4],
    mieDensity: [EMPTY_LAYER, expLayer(11)],
    mieScattering: [0.0277773, 0.0246273, 0.0203318],
    mieExtinction: [0.0286364, 0.0286364, 0.0286364],
    miePhaseFunctionG: 0.8,
    absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
    absorptionExtinction: [0, 0, 0],
    groundAlbedo: [0.1, 0.1, 0.1],
    muSMin: -0.2
  }
}

/** Звезда-корень (категория 10, как в LightTint.spec) с заданной подпиской на цвет света */
function starStub(temperature: number, lightTint: number): Actor {
  return {
    parent: null,
    getAttribute: (key: string): unknown => (key === 'categoryId' ? 10 : undefined),
    renderingObject: { getAttribute: () => ({ lightTint }) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'temperature' ? temperature : def)
    }
  } as unknown as Actor
}

function atmosphereStub(config: AtmosphereConfig, parent: Actor | null): Actor {
  return {
    parent,
    renderingObject: { getAttribute: () => config },
    getAttribute: (key: string) => (key === 'id' ? 42 : key === 'parentId' ? 41 : 'StubAtmosphere')
  } as unknown as Actor
}

describe('tintSolarIrradiance', () => {
  it('белый свет — тождество', () => {
    expect(tintSolarIrradiance([1.474, 1.8504, 1.91198], { r: 1, g: 1, b: 1 })).toEqual([1.474, 1.8504, 1.91198])
  })

  it('покомпонентное произведение', () => {
    expect(tintSolarIrradiance([2, 4, 8], { r: 0.5, g: 0.25, b: 1 })).toEqual([1, 1, 8])
  })
})

describe('BrunetonAtmosphere: излучение окрашено цветом света светила', () => {
  beforeEach(() => generateSpy.mockClear())

  it('без светила (стаб без родителей) — излучение ровно из данных', () => {
    const registry = new AtmosphereRegistry()
    new BrunetonAtmosphere(atmosphereStub(stubConfig(), null), {} as WebGLRenderer, registry)

    expect(registry.entries()[0].config.solarIrradiance).toEqual(EARTH_SOLAR)
  })

  it('звезда без подписки (lightTint 0) — ровно EARTH_SOLAR', () => {
    const registry = new AtmosphereRegistry()
    new BrunetonAtmosphere(atmosphereStub(stubConfig(), starStub(5772, 0)), {} as WebGLRenderer, registry)

    expect(registry.entries()[0].config.solarIrradiance).toEqual(EARTH_SOLAR)
  })

  it('красная звезда с подпиской — EARTH_SOLAR ⊙ lightColorOf, одно значение в LUT и в реестре', () => {
    const star = starStub(3700, 0.8)
    const config = stubConfig()
    const registry = new AtmosphereRegistry()
    new BrunetonAtmosphere(atmosphereStub(config, star), {} as WebGLRenderer, registry)

    const c = lightColorOf(star)
    const expected = [EARTH_SOLAR[0] * c.r, EARTH_SOLAR[1] * c.g, EARTH_SOLAR[2] * c.b]
    const entry = registry.entries()[0]

    expected.forEach((v, i) => expect(entry.config.solarIrradiance[i]).toBeCloseTo(v, 12))
    expect(generateSpy.mock.calls[0][0].solarIrradiance).toEqual(entry.config.solarIrradiance)
    // данные не мутированы: окраска — в копии конфига
    expect(config.solarIrradiance).toEqual(EARTH_SOLAR)
    expect(entry.config).not.toBe(config)
  })
})

describe('Поставляемая база: ручной окраски излучения нет', () => {
  type Row = { id: number; actorId: number; data: { solarIrradiance?: number[] } }
  const atmospheres = (RenderingObjects as unknown as Row[]).filter((r) => Array.isArray(r.data.solarIrradiance))

  it('у всех атмосфер в данных EARTH_SOLAR — окраску даёт только звезда', () => {
    expect(atmospheres.length).toBeGreaterThanOrEqual(22)
    for (const row of atmospheres) expect(row.data.solarIrradiance, `ro ${row.id}`).toEqual(EARTH_SOLAR)
  })

  it.each([
    ['Halcyra (W26, 3700 K)', 124, [1.474, 1.2066, 0.8591]],
    ['Nivalis (W26, 3700 K)', 126, [1.474, 1.2066, 0.8591]],
    ['Thalorn (Alkaid, 15540 K)', 131, [0.8307, 1.2661, 1.912]],
    ['Isvara (Alkaid, 15540 K)', 134, [0.8307, 1.2661, 1.912]]
  ] as const)('%s: эффективное излучение = EARTH_SOLAR ⊙ цвет света звезды', (_name, atmosphereActorId, expected) => {
    const color = resolveLightTint(Actor.find(atmosphereActorId)!).color
    const effective = tintSolarIrradiance(EARTH_SOLAR, color)

    expected.forEach((v, i) => expect(effective[i]).toBeCloseTo(v, 3))
  })

  it('Земля (Солнце без подписки): множитель ровно белый', () => {
    const color = resolveLightTint(Actor.find(47)!).color

    expect([color.r, color.g, color.b]).toEqual([1, 1, 1])
  })
})
