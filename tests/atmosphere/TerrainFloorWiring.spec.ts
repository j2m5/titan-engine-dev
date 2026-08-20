import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
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

function stubActor(terrainFloorMeters?: unknown): Actor {
  return {
    renderingObject: { getAttribute: () => stubConfig(terrainFloorMeters) },
    getAttribute: () => 'StubPlanet'
  } as unknown as Actor
}

// LUT-генератор трогает GPU, которого в jsdom нет: подменяем на пустышку,
// запоминающую конфиг — совпадение конфига LUT и юниформов ассертится ниже.
const generateCalls: AtmosphereConfig[] = []
vi.mock('@/core/renderables/Atmosphere/AtmosphereLUTGenerator', () => ({
  AtmosphereLUTGenerator: class {
    public generate(config: AtmosphereConfig): { transmittance: null; scattering: null; irradiance: null } {
      generateCalls.push(config)
      return { transmittance: null, scattering: null, irradiance: null }
    }
    public dispose(): void {}
  }
}))

describe('BrunetonAtmosphere: дно следует объявленному полу рельефа', () => {
  beforeEach(() => {
    generateCalls.length = 0
  })

  afterEach(() => {
    heightFieldStorage.clear()
  })

  it('реестр карт высот ПУСТ — подгонка всё равно происходит: источник пола в данных, а не в загрузке', () => {
    // Ровно продакшн-состояние на сборке сцены: Application.teardown чистит
    // реестр, гейт грузит карту только на подлёте (32 px). Прежняя реализация
    // здесь молча отдавала bottomRadius нетронутым.
    expect(heightFieldStorage.heldPaths()).toEqual([])

    const atmosphere = new BrunetonAtmosphere(stubActor(-8174.25), {} as WebGLRenderer)

    expect(atmosphere.material.uniforms.u_bottom_radius.value).toBeCloseTo(3390 - 8.17425, 9)
  })

  it('дно опущено на |пол| у ОБОИХ проходов — пропускание и in-scatter делят одну геометрию атмосферы', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(-8174.25), {} as WebGLRenderer)

    expect(atmosphere.material.uniforms.u_bottom_radius.value).toBeCloseTo(3390 - 8.17425, 9)
    expect(atmosphere.scatterPass.material.uniforms.u_bottom_radius.value).toBeCloseTo(3390 - 8.17425, 9)
  })

  it('компенсация оптики доехала до юниформов — множитель в профиле, коэффициенты нетронуты', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(-8174.25), {} as WebGLRenderer)

    // Слой в юниформе — [width, expTerm, expScale, linearTerm, constantTerm]
    const rayleighLayer = atmosphere.material.uniforms.u_rayleigh_layer1.value as Float32Array
    const mieLayer = atmosphere.material.uniforms.u_mie_layer1.value as Float32Array

    expect(rayleighLayer[1]).toBeCloseTo(Math.exp(8.17425 / 10.859), 4)
    expect(mieLayer[1]).toBeCloseTo(Math.exp(8.17425 / 11), 4)

    // Коэффициенты остаются паспортными — их подгонка дна не касается
    expect(atmosphere.material.uniforms.u_rayleigh_scattering.value.x).toBeCloseTo(1.21533e-4, 12)
    expect(atmosphere.material.uniforms.u_mie_extinction.value.x).toBeCloseTo(0.0286364, 12)
  })

  it('LUT генерируются из того же подогнанного конфига, что и юниформы', () => {
    new BrunetonAtmosphere(stubActor(-8174.25), {} as WebGLRenderer)

    expect(generateCalls).toHaveLength(1)
    expect(generateCalls[0].bottomRadius).toBeCloseTo(3390 - 8.17425, 9)
  })

  it('пол не объявлен — дно и оптика прежние (легаси-путь бит-в-бит)', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer)

    expect(atmosphere.material.uniforms.u_bottom_radius.value).toBe(3390)
    expect(atmosphere.material.uniforms.u_rayleigh_scattering.value.x).toBeCloseTo(1.21533e-4, 12)
    expect(generateCalls[0].bottomRadius).toBe(3390)
  })

  it.each([
    ['NaN', NaN],
    ['числовая строка из БД', '-8174.25'],
    ['null', null],
    ['-Infinity', -Infinity],
    ['положительный (пол выше опорной сферы)', 120]
  ])('нечисловой или неотрицательный пол (%s) — дно прежнее, а не мусор в LUT', (_label, value) => {
    const atmosphere = new BrunetonAtmosphere(stubActor(value), {} as WebGLRenderer)

    expect(atmosphere.material.uniforms.u_bottom_radius.value).toBe(3390)
    expect(generateCalls[0].bottomRadius).toBe(3390)
  })

  it('геометрия меша остаётся на topRadius — подгонка дна её не трогает', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(-8174.25), {} as WebGLRenderer)
    const withoutTerrain = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer)

    expect(atmosphere.geometry.getAttribute('position').count).toBe(
      withoutTerrain.geometry.getAttribute('position').count
    )
    expect((atmosphere.geometry as unknown as { parameters: { radius: number } }).parameters.radius).toBe(
      (withoutTerrain.geometry as unknown as { parameters: { radius: number } }).parameters.radius
    )
  })
})
