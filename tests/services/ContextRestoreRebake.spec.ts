import { PerspectiveCamera, Vector2, type WebGLRenderer } from 'three'
import type { Actor } from '@/core/models/Actor'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { EARTH_SOLAR, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { ProceduralSurfaceGenerator } from '@/core/services/ProceduralSurfaceGenerator'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Nebula } from '@/core/renderables/Nebula'
import { ImpostorBaker } from '@/core/renderables/Nebula/volume/ImpostorBaker'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'

/**
 * Потеря контекста стирает содержимое render target'ов: three пересоздаёт их
 * пустыми. Всё, что запекается на GPU один раз, обязано перезапечься на
 * `webglcontextrestored`, иначе после восстановления — чёрные атмосферы,
 * чёрные процедурные диффузы и пустая туманность.
 */

const { generateSpy } = vi.hoisted(() => ({
  generateSpy: vi.fn((_config: AtmosphereConfig) => ({ transmittance: null, scattering: null, irradiance: null }))
}))

// Остальные экспорты модуля (размеры LUT) нужны соседям по графу импорта
vi.mock('@/core/renderables/Atmosphere/AtmosphereLUTGenerator', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  AtmosphereLUTGenerator: class {
    public generate(config: AtmosphereConfig): { transmittance: null; scattering: null; irradiance: null } {
      return generateSpy(config)
    }
    public dispose(): void {}
  }
}))

/** Рендерер-заглушка с настоящим EventTarget в роли канваса */
function makeRenderer(): { renderer: WebGLRenderer; canvas: EventTarget; render: ReturnType<typeof vi.fn> } {
  const canvas = new EventTarget()
  const render = vi.fn()
  const renderer = {
    domElement: canvas,
    render,
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    getClearAlpha: () => 1,
    setClearAlpha: vi.fn(),
    clear: vi.fn(),
    getSize: (v: Vector2) => v.set(1920, 1080)
  } as unknown as WebGLRenderer

  return { renderer, canvas, render }
}

function restore(canvas: EventTarget): void {
  canvas.dispatchEvent(new Event('webglcontextrestored'))
}

function atmosphereConfig(): AtmosphereConfig {
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

function atmosphereActor(): Actor {
  const config = atmosphereConfig()

  return {
    parent: null,
    renderingObject: { getAttribute: () => config },
    getAttribute: (key: string) => (key === 'id' ? 42 : key === 'parentId' ? 41 : 'StubAtmosphere')
  } as unknown as Actor
}

function proceduralActor(): Actor {
  const data = {
    proceduralSurface: {
      seed: 931,
      frequencyPerRadius: 3,
      octaves: 6,
      gain: 0.5,
      lacunarity: 2,
      contrast: 1.3,
      palette: ['#1c1414', '#4a241d', '#7a3b28', '#a8683f'],
      albedoNoise: 0.35
    }
  }

  return {
    getAttribute: (key: string, fallback?: unknown): unknown =>
      key === 'id' ? 93 : key === 'name' ? 'Stub 93' : fallback,
    renderingObject: { getAttribute: (key: string): unknown => (key === 'data' ? data : undefined) },
    physicalObject: { getAttribute: (key: string): unknown => (key === 'radius' ? 1740 : undefined) }
  } as unknown as Actor
}

describe('Восстановление контекста: одноразовые GPU-бейки пересчитываются', () => {
  beforeEach(() => {
    generateSpy.mockClear()
    resourceStorage.deleteAllTextures()
  })

  afterEach(() => vi.restoreAllMocks())

  it('атмосфера пересчитывает LUT тем же конфигом; после dispose — нет', () => {
    const { renderer, canvas } = makeRenderer()
    const atmosphere = new BrunetonAtmosphere(atmosphereActor(), renderer, new AtmosphereRegistry())

    restore(canvas)

    expect(generateSpy).toHaveBeenCalledTimes(2)
    expect(generateSpy.mock.calls[1][0]).toBe(generateSpy.mock.calls[0][0])

    atmosphere.dispose()
    restore(canvas)

    expect(generateSpy).toHaveBeenCalledTimes(2)
  })

  it('процедурный диффуз перерисовывается в тот же таргет; после dispose генератора — нечего', () => {
    const { renderer, canvas, render } = makeRenderer()
    const generator = new ProceduralSurfaceGenerator(renderer)
    const setRenderTarget = vi.mocked(renderer.setRenderTarget)

    generator.ensureDiffuse(proceduralActor())

    const target = setRenderTarget.mock.calls[0][0]

    render.mockClear()
    setRenderTarget.mockClear()
    restore(canvas)

    expect(render).toHaveBeenCalledTimes(1)
    expect(setRenderTarget.mock.calls[0][0]).toBe(target)

    generator.dispose()
    render.mockClear()
    restore(canvas)

    expect(render).not.toHaveBeenCalled()
  })

  it('туманность перепекает поле плотности сразу, импостор — на ближайшем кадре; после dispose — нет', () => {
    const { renderer, canvas } = makeRenderer()
    const densityBake = vi.spyOn(NebulaDensityBaker.prototype, 'bake')
    const impostorBake = vi.spyOn(ImpostorBaker.prototype, 'bake')
    const nebula = new Nebula(renderer, { size: 500, quality: { bake3DTexture: true, bakeResolution: 16 } })
    const camera = new PerspectiveCamera(50, 16 / 9, 1e-6, 1e12)

    camera.position.set(3e6, 4e6, 5e6)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    const frame = (): void => nebula.updateObject({ delta: 0, epoch: 0, elapsed: 0, camera })

    frame()
    frame()

    expect(densityBake).toHaveBeenCalledTimes(1)
    // ракурс не менялся — повторного бейка импостора нет
    expect(impostorBake).toHaveBeenCalledTimes(1)

    restore(canvas)
    frame()

    expect(densityBake).toHaveBeenCalledTimes(2)
    expect(impostorBake).toHaveBeenCalledTimes(2)

    nebula.dispose()
    restore(canvas)

    expect(densityBake).toHaveBeenCalledTimes(2)
  })
})
