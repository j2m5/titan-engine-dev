import { afterEach, describe, expect, it, vi } from 'vitest'
import { Object3D, PerspectiveCamera, Scene, Texture, type WebGLRenderer } from 'three'
import { RenderingObjects } from '@storage/database'
import { SpaceScale } from '@/core/constants'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { createSkyUniforms } from '@/core/materials/shaders/lib/chunks/SkySample'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { adjustAtmosphereForTerrainFloor } from '@/core/renderables/Atmosphere/terrainFloorAdjust'
import { AtmosphereRegistry, type AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { emptyEclipseData } from '@/core/eclipse/eclipseUniforms'

const earth = RenderingObjects.find((row) => row.actorId === 47)!.data as unknown as AtmosphereConfig
const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})

function fixture(config: AtmosphereConfig = earth) {
  const scene = new Scene()
  const planet = new Object3D()
  planet.position.set(1e6 * SpaceScale, 0, 0)
  scene.add(planet)
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e8)
  const registry = new AtmosphereRegistry()
  const entry: AtmosphereEntry = {
    actorId: 47,
    name: 'Earth',
    generation: 0,
    ready: true,
    object: planet,
    config,
    lut: { transmittance: new Texture(), scattering: new Texture(), irradiance: new Texture() }
  }
  registry.register(entry)
  const pp = new Postprocessing(
    { domElement: document.createElement('canvas') } as unknown as WebGLRenderer,
    scene,
    camera,
    registry,
    new DepthVolumeRegistry()
  )
  const gaia = createSkyUniforms('gaia')
  const cubemap = createSkyUniforms('cubemap')
  const observed: Array<[number, number]> = []
  const composer = {
    render: vi.fn(() => {
      observed.push([gaia.uSkyAtmosphereVisibility?.value ?? 1, cubemap.uSkyAtmosphereVisibility?.value ?? 1])
    }),
    dispose: vi.fn()
  }
  pp.composer = composer as never
  cleanup.push(() => {
    pp.dispose()
    Object.values(entry.lut).forEach((texture) => texture.dispose())
  })
  function render(altitudeKm: number, sunCosine = 1): number {
    const radius = earth.bottomRadius + altitudeKm
    camera.position
      .set(-radius * sunCosine, radius * Math.sqrt(1 - sunCosine * sunCosine), 0)
      .multiplyScalar(SpaceScale)
      .add(planet.position)
    pp.render()
    const latest = observed.at(-1)!
    expect(latest[1]).toBe(latest[0])
    return latest[0]
  }
  return { render, pp, composer, registry, entry, gaia }
}

describe('star visibility during the scene render', () => {
  it('hides the enhanced background in the sunlit lower Earth atmosphere for both sky sources', () => {
    const f = fixture()
    expect(f.render(0.01)).toBeLessThan(1e-4)
    expect(f.render(5)).toBeLessThan(1e-4)
  })

  it('keeps the night side and the geometric terminator free of extra dimming', () => {
    const f = fixture()
    for (const sun of [-1, -0.1, -0.001, 0]) expect(f.render(0.01, sun)).toBe(1)
  })

  it('restores stars continuously with altitude and leaves orbit unchanged', () => {
    const f = fixture()
    const visibility = [0.01, 5, 10, 15, 20, 30, 40, 60, 1000].map((h) => f.render(h))
    expect(visibility[0]).toBeLessThan(1e-4)
    expect(visibility[4]).toBeGreaterThan(0.5)
    expect(visibility[6]).toBeGreaterThan(0.99)
    expect(visibility[7]).toBe(1)
    expect(visibility[8]).toBe(1)
    for (let i = 1; i < visibility.length; i++) expect(visibility[i]).toBeGreaterThanOrEqual(visibility[i - 1])
    expect(Math.abs(f.render(20.001) - f.render(20))).toBeLessThan(0.001)
  })

  it('fades smoothly after sunrise without a day/night switch', () => {
    const f = fixture()
    const dawn = f.render(0.01, 0.02)
    expect(dawn).toBeGreaterThan(f.render(0.01, 0.08))
    expect(dawn).toBeLessThan(1)
    expect(Math.abs(f.render(0.01, 0.02001) - dawn)).toBeLessThan(0.001)
  })

  it('uses scattering density rather than the mere presence of an atmosphere', () => {
    const f = fixture({
      ...earth,
      rayleighScattering: [0.00005802, 0.00013558, 0.000331],
      mieScattering: [0.00003996, 0.00003996, 0.00003996]
    })
    expect(f.render(0.01)).toBeGreaterThan(0.99)
    f.entry.config = { ...earth, rayleighScattering: [0, 0, 0], mieScattering: [0, 0, 0] }
    expect(f.render(0.01)).toBe(1)
  })

  it('does not wash out stars without stellar illumination or during a total eclipse', () => {
    const f = fixture({ ...earth, solarIrradiance: [0, 0, 0] })
    expect(f.render(0.01)).toBe(1)
    f.entry.config = earth
    const eclipse = emptyEclipseData()
    eclipse.count = 1
    eclipse.star.set(-1e6, 0, 0)
    eclipse.starRadius = 1000
    eclipse.occluders[0].set(-10000, 0, 0, 100)
    f.entry.eclipse = eclipse
    expect(f.render(0.01)).toBe(1)
  })

  it('uses the same optical altitude after the terrain floor is lowered', () => {
    const normal = fixture()
    const lowered = fixture(adjustAtmosphereForTerrainFloor(earth, -8000))
    expect(lowered.render(20)).toBeCloseTo(normal.render(20), 3)
  })

  it('updates before drawing and restores shared uniforms after rendering, including failures', () => {
    const f = fixture()
    expect(f.render(0.01)).toBeLessThan(1e-4)
    expect(f.gaia.uSkyAtmosphereVisibility?.value).toBe(1)
    f.composer.render.mockImplementationOnce(() => {
      expect(f.gaia.uSkyAtmosphereVisibility.value).toBeLessThan(1e-4)
      throw new Error('render failure')
    })
    expect(() => f.pp.render()).toThrow('render failure')
    expect(f.gaia.uSkyAtmosphereVisibility.value).toBe(1)
  })

  it('restores full background visibility when the atmosphere becomes pending or is removed', () => {
    const f = fixture()
    expect(f.render(0.01)).toBeLessThan(1e-4)
    f.registry.markPending(47)
    expect(f.render(0.01)).toBe(1)
    f.registry.markReady(47)
    expect(f.render(0.01)).toBeLessThan(1e-4)
    f.registry.unregister(47)
    expect(f.render(0.01)).toBe(1)
  })
})
