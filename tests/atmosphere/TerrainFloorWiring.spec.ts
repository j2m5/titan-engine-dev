import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Actor } from '@/core/models/Actor'
import { WebGLRenderer } from 'three'

function stubConfig(): AtmosphereConfig {
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
    muSMin: -0.2
  }
}

const MARS_HEIGHT_PATH = 'planets/mars/mars_height.raw'

function stubActor(withTerrainParent: boolean): Actor {
  const parent = withTerrainParent
    ? {
        resources: {
          where: () => ({ first: () => ({ getAttribute: () => MARS_HEIGHT_PATH }) })
        }
      }
    : null

  return {
    renderingObject: { getAttribute: () => stubConfig() },
    getAttribute: () => 'StubPlanet',
    parent
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

function seedMarsHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(MARS_HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: -8174.25,
    maxMeters: 21171.5,
    data: new Uint16Array(8)
  })
}

describe('BrunetonAtmosphere: дно следует полу рельефа родителя', () => {
  beforeEach(() => {
    generateCalls.length = 0
  })

  afterEach(() => {
    heightFieldStorage.clear()
  })

  it('терраформный родитель — u_bottom_radius опущен на |пол| у обоих проходов', () => {
    seedMarsHeightMap()
    const atmosphere = new BrunetonAtmosphere(stubActor(true), {} as WebGLRenderer)

    expect(atmosphere.material.uniforms.u_bottom_radius.value).toBeCloseTo(3390 - 8.17425, 9)
    expect(atmosphere.scatterPass.material.uniforms.u_bottom_radius.value).toBeCloseTo(3390 - 8.17425, 9)
  })

  it('компенсация оптики доехала до юниформов — множитель в профиле, коэффициенты нетронуты', () => {
    seedMarsHeightMap()
    const atmosphere = new BrunetonAtmosphere(stubActor(true), {} as WebGLRenderer)

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
    seedMarsHeightMap()
    new BrunetonAtmosphere(stubActor(true), {} as WebGLRenderer)

    expect(generateCalls).toHaveLength(1)
    expect(generateCalls[0].bottomRadius).toBeCloseTo(3390 - 8.17425, 9)
  })

  it('карта не загружена — дно и оптика прежние (легаси-путь бит-в-бит)', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(true), {} as WebGLRenderer)

    expect(atmosphere.material.uniforms.u_bottom_radius.value).toBe(3390)
    expect(atmosphere.material.uniforms.u_rayleigh_scattering.value.x).toBeCloseTo(1.21533e-4, 12)
    expect(generateCalls[0].bottomRadius).toBe(3390)
  })

  it('актор без родителя — дно прежнее', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(false), {} as WebGLRenderer)

    expect(atmosphere.material.uniforms.u_bottom_radius.value).toBe(3390)
  })

  it('геометрия меша остаётся на topRadius — подгонка дна её не трогает', () => {
    seedMarsHeightMap()
    const atmosphere = new BrunetonAtmosphere(stubActor(true), {} as WebGLRenderer)
    const withoutTerrain = new BrunetonAtmosphere(stubActor(false), {} as WebGLRenderer)

    expect(atmosphere.geometry.getAttribute('position').count).toBe(
      withoutTerrain.geometry.getAttribute('position').count
    )
    expect((atmosphere.geometry as unknown as { parameters: { radius: number } }).parameters.radius).toBe(
      (withoutTerrain.geometry as unknown as { parameters: { radius: number } }).parameters.radius
    )
  })
})
