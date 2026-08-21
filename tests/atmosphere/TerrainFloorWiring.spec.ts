import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { adjustAtmosphereForTerrainFloor } from '@/core/renderables/Atmosphere/terrainFloorAdjust'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Actor } from '@/core/models/Actor'
import { WebGLRenderer } from 'three'

/**
 * Пол рельефа приходит ИЗ КОНФИГА атмосферы, а не из реестра карт высот, и
 * этот стенд нарочно не засевает реестр ничем: до ревью 2026-08-20 (находка
 * №3) `terrainFloorMetersFor` читала реестр в конструкторе атмосферы, куда
 * карта после гейта не успевает НИКОГДА — фича была мертва, а зелёный
 * wiring-тест это скрывал, потому что засевал реестр сам.
 */
function stubConfig(terrainFloorMeters?: unknown): AtmosphereConfig {
  return {
    solarIrradiance: [1.474, 1.8504, 1.91198],
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
    muSMin: -0.2,
    ...(terrainFloorMeters === undefined ? {} : { terrainFloorMeters: terrainFloorMeters as number })
  }
}

function stubActor(config: AtmosphereConfig): Actor {
  return {
    renderingObject: { getAttribute: () => config },
    getAttribute: (key: string) => (key === 'id' ? 42 : 'StubPlanet')
  } as unknown as Actor
}

// LUT-генератор трогает GPU, которого в jsdom нет: подменяем на пустышку,
// запоминающую конфиг — совпадение конфига LUT и записи реестра ассертится ниже.
const { generateSpy, disposeSpy } = vi.hoisted(() => ({
  generateSpy: vi.fn((_config: AtmosphereConfig) => ({ transmittance: null, scattering: null, irradiance: null })),
  disposeSpy: vi.fn()
}))

vi.mock('@/core/renderables/Atmosphere/AtmosphereLUTGenerator', () => ({
  AtmosphereLUTGenerator: class {
    public generate(config: AtmosphereConfig): { transmittance: null; scattering: null; irradiance: null } {
      return generateSpy(config)
    }
    public dispose(): void {
      disposeSpy()
    }
  }
}))

describe('BrunetonAtmosphere: дно следует объявленному полу рельефа', () => {
  beforeEach(() => {
    generateSpy.mockClear()
    disposeSpy.mockClear()
  })

  afterEach(() => {
    heightFieldStorage.clear()
  })

  it('реестр карт высот ПУСТ — подгонка всё равно происходит: источник пола в данных, а не в загрузке', () => {
    // Ровно продакшн-состояние на сборке сцены: Application.teardown чистит
    // реестр, гейт грузит карту только на подлёте (32 px). Прежняя реализация
    // здесь молча отдавала bottomRadius нетронутым.
    expect(heightFieldStorage.heldPaths()).toEqual([])

    const registry = new AtmosphereRegistry()
    new BrunetonAtmosphere(stubActor(stubConfig(-8174.25)), {} as WebGLRenderer, registry)

    expect(registry.entries()[0].config.bottomRadius).toBeCloseTo(3390 - 8.17425, 9)
  })

  it('LUT и запись реестра считаются из ОДНОГО подогнанного конфига', () => {
    const registry = new AtmosphereRegistry()
    const actor = stubActor({ ...stubConfig(), terrainFloorMeters: -8174.25 })
    const node = new BrunetonAtmosphere(actor, {} as WebGLRenderer, registry)

    const entry = registry.entries()[0]
    expect(entry.object).toBe(node)
    expect(entry.config).toEqual(
      adjustAtmosphereForTerrainFloor({ ...stubConfig(), terrainFloorMeters: -8174.25 }, -8174.25)
    )
    expect(entry.config.bottomRadius).toBeCloseTo(stubConfig().bottomRadius - 8.17425, 9)
    // generate() мока получил тот же объект
    expect(generateSpy).toHaveBeenCalledWith(entry.config)
  })

  it('компенсация оптики доехала до записи реестра — множитель в профиле, коэффициенты нетронуты', () => {
    const registry = new AtmosphereRegistry()
    new BrunetonAtmosphere(stubActor(stubConfig(-8174.25)), {} as WebGLRenderer, registry)

    const config = registry.entries()[0].config

    expect(config.rayleighDensity[1].expTerm).toBeCloseTo(Math.exp(8.17425 / 10.859), 4)
    expect(config.mieDensity[1].expTerm).toBeCloseTo(Math.exp(8.17425 / 11), 4)

    // Коэффициенты остаются паспортными — их подгонка дна не касается
    expect(config.rayleighScattering[0]).toBeCloseTo(1.21533e-4, 12)
    expect(config.mieExtinction[0]).toBeCloseTo(0.0286364, 12)
  })

  it('пол не объявлен — дно и оптика прежние (легаси-путь бит-в-бит)', () => {
    const registry = new AtmosphereRegistry()
    new BrunetonAtmosphere(stubActor(stubConfig()), {} as WebGLRenderer, registry)

    expect(registry.entries()[0].config.bottomRadius).toBe(3390)
    expect(registry.entries()[0].config.rayleighScattering[0]).toBeCloseTo(1.21533e-4, 12)
    expect(generateSpy.mock.calls[0][0].bottomRadius).toBe(3390)
  })

  it.each([
    ['NaN', NaN],
    ['числовая строка из БД', '-8174.25'],
    ['null', null],
    ['-Infinity', -Infinity],
    ['положительный (пол выше опорной сферы)', 120]
  ])('нечисловой или неотрицательный пол (%s) — дно прежнее, а не мусор в LUT', (_label, value) => {
    const registry = new AtmosphereRegistry()
    new BrunetonAtmosphere(stubActor(stubConfig(value)), {} as WebGLRenderer, registry)

    expect(registry.entries()[0].config.bottomRadius).toBe(3390)
    expect(generateSpy.mock.calls[0][0].bottomRadius).toBe(3390)
  })

  it('dispose снимает запись из реестра и освобождает генератор', () => {
    const registry = new AtmosphereRegistry()
    const node = new BrunetonAtmosphere(stubActor(stubConfig()), {} as WebGLRenderer, registry)
    node.dispose()
    expect(registry.size).toBe(0)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('узел — не Mesh: ни геометрии, ни материала, ни дочернего прохода', () => {
    const node = new BrunetonAtmosphere(stubActor(stubConfig()), {} as WebGLRenderer, new AtmosphereRegistry())
    expect((node as unknown as { geometry?: unknown }).geometry).toBeUndefined()
    expect((node as unknown as { material?: unknown }).material).toBeUndefined()
    expect(node.children).toHaveLength(0)
  })
})
