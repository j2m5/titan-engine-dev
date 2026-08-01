import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { AtmosphereConfig, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { Actor } from '@/core/models/Actor'
import { Mesh, WebGLRenderer } from 'three'

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

describe('BrunetonAtmosphere: меши двух проходов', () => {
  it('сам объект — проход пропускания, дочерний меш — проход in-scatter', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer)

    expect(atmosphere.material.defines.ATMOSPHERE_PASS_TRANSMITTANCE).toBe('1')
    expect(atmosphere.scatterPass).toBeInstanceOf(Mesh)
    expect((atmosphere.scatterPass.material as BrunetonAtmosphereMaterial).defines.ATMOSPHERE_PASS_TRANSMITTANCE)
      .toBeUndefined()
  })

  it('проход in-scatter — единственный потомок и рисуется после умножения', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer)

    expect(atmosphere.children).toHaveLength(1)
    expect(atmosphere.renderOrder).toBeLessThan(atmosphere.scatterPass.renderOrder)
  })

  it('геометрия общая — вершины не дублируются', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer)

    expect(atmosphere.scatterPass.geometry).toBe(atmosphere.geometry)
  })

  it('юниформы общие — update одного прохода кормит оба', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer)
    const scatter = atmosphere.scatterPass.material as BrunetonAtmosphereMaterial

    expect(scatter.uniforms).toBe(atmosphere.material.uniforms)
  })

  it('dispose освобождает оба материала и геометрию один раз', () => {
    const atmosphere = new BrunetonAtmosphere(stubActor(), {} as WebGLRenderer)
    const scatter = atmosphere.scatterPass.material as BrunetonAtmosphereMaterial
    const geometryDispose = vi.spyOn(atmosphere.geometry, 'dispose')
    const scatterDispose = vi.spyOn(scatter, 'dispose')

    atmosphere.dispose()

    expect(scatterDispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
  })
})
