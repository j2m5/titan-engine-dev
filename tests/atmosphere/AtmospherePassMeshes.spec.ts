import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DUST_RENDER_ORDER } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { RING_RENDER_ORDER } from '@/core/renderables/Ring'
import { Actor } from '@/core/models/Actor'
import { BufferGeometry, Mesh, WebGLRenderer } from 'three'

function stubConfig(): AtmosphereConfig {
  return {
    solarIrradiance: [1.474, 1.8504, 1.91198],
    sunAngularRadius: 0.004,
    bottomRadius: 6360,
    topRadius: 6420,
    rayleighDensity: [EMPTY_LAYER, expLayer(8)],
    rayleighScattering: [0.005802, 0.013558, 0.0331],
    mieDensity: [EMPTY_LAYER, expLayer(1.2)],
    mieScattering: [0.003996, 0.003996, 0.003996],
    mieExtinction: [0.00444, 0.00444, 0.00444],
    miePhaseFunctionG: 0.8,
    absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
    absorptionExtinction: [0, 0, 0],
    groundAlbedo: [0.1, 0.1, 0.1],
    muSMin: -0.2
  }
}

function stubActor(): Actor {
  return {
    renderingObject: { getAttribute: () => stubConfig() },
    getAttribute: () => 'StubPlanet'
  } as unknown as Actor
}

// LUT-генератор трогает GPU, которого в jsdom нет: подменяем на пустышку.
// Материалу достаточно, что bindLUTTextures получил объект нужной формы.
vi.mock('@/core/renderables/Atmosphere/AtmosphereLUTGenerator', () => ({
  AtmosphereLUTGenerator: class {
    public generate(): { transmittance: null; scattering: null; irradiance: null } {
      return { transmittance: null, scattering: null, irradiance: null }
    }
    public dispose(): void {}
  }
}))

/** Форма узла ДО перехода на полноэкранный эффект: меша у него больше нет. */
type LegacyAtmosphere = BrunetonAtmosphere & {
  material: BrunetonAtmosphereMaterial
  geometry: BufferGeometry
  scatterPass: Mesh<BufferGeometry, BrunetonAtmosphereMaterial>
}

function makeLegacyAtmosphere(): LegacyAtmosphere {
  const node = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer, new AtmosphereRegistry())

  return node as unknown as LegacyAtmosphere
}

// снимается Task 5 плана 2026-08-21
describe.skip('BrunetonAtmosphere: меши двух проходов', () => {
  it('сам объект — проход пропускания, дочерний меш — проход in-scatter', () => {
    const atmosphere = makeLegacyAtmosphere()

    expect(atmosphere.material.defines.ATMOSPHERE_PASS_TRANSMITTANCE).toBe('1')
    expect(atmosphere.scatterPass).toBeInstanceOf(Mesh)
    expect(atmosphere.scatterPass.material.defines.ATMOSPHERE_PASS_TRANSMITTANCE).toBeUndefined()
  })

  it('проход in-scatter — единственный потомок и рисуется после умножения', () => {
    const atmosphere = makeLegacyAtmosphere()

    expect(atmosphere.children).toHaveLength(1)
    expect(atmosphere.renderOrder).toBeLessThan(atmosphere.scatterPass.renderOrder)
  })

  it('геометрия общая — вершины не дублируются', () => {
    const atmosphere = makeLegacyAtmosphere()

    expect(atmosphere.scatterPass.geometry).toBe(atmosphere.geometry)
  })

  it('юниформы общие — update одного прохода кормит оба', () => {
    const atmosphere = makeLegacyAtmosphere()
    const scatter = atmosphere.scatterPass.material

    expect(scatter.uniforms).toBe(atmosphere.material.uniforms)
  })

  it('dispose освобождает оба материала и геометрию один раз', () => {
    const atmosphere = makeLegacyAtmosphere()
    const scatter = atmosphere.scatterPass.material
    const geometryDispose = vi.spyOn(atmosphere.geometry, 'dispose')
    const scatterDispose = vi.spyOn(scatter, 'dispose')

    atmosphere.dispose()

    expect(scatterDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
  })

  it('пыль кольца рисуется строго после in-scatter атмосферы — иначе гало ляжет на недостроенную атмосферу', () => {
    const atmosphere = makeLegacyAtmosphere()

    expect(DUST_RENDER_ORDER).toBeGreaterThan(atmosphere.scatterPass.renderOrder)
  })

  // Инвариант H4: прозрачное ПЕРЕД планетой — после обоих проходов, иначе
  // проход A гасит его пропусканием столба до земли, а B кладёт дымку.
  // Кольцо держалось на дефолтном 0 и делило точку сортировки с проходом A:
  // порядок решал тай-брейк по id. Пыль — гало текстуры кольца, поверх неё.
  it('кольцо рисуется после in-scatter атмосферы, пыль — поверх кольца', () => {
    const atmosphere = makeLegacyAtmosphere()

    expect(RING_RENDER_ORDER).toBeGreaterThan(atmosphere.scatterPass.renderOrder)
    expect(DUST_RENDER_ORDER).toBeGreaterThan(RING_RENDER_ORDER)
  })
})
