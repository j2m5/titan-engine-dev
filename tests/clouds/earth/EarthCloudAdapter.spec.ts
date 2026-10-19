import { describe, expect, it, vi } from 'vitest'
import { DataTexture, Matrix3, PerspectiveCamera, Quaternion, RGBAFormat, Vector3 } from 'three'
import { RenderingObjects } from '@storage/database'
import { resolveCloudConfig } from '@/core/clouds/validateCloudConfig'
import { cloudShellDistance, cloudVolumeOpacity } from '@/core/clouds/cloudLod'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { createEarthAtmosphere, createEarthClouds, setEarthCloudQuality } from '@/labs/earth-clouds/EarthCloudAdapter'
import { applyPlanetCloudLayer, toTakramAtmosphere } from '@/core/clouds/takram/planetCloudAdapter'
import { bindCloudAppearance } from '@/core/clouds/appearance/cloudAppearance'
import type { CloudAppearanceTextures } from '@/core/clouds/appearance/cloudAppearanceTextures'
import { prepareCloudTargets } from '@/core/clouds/takram/prepareCloudTargets'

describe('Earth cloud adapter', () => {
  it('applies the authored vertical shape and restores the legacy shape when the next profile omits it', () => {
    const clouds = createEarthClouds(new PerspectiveCamera(), createEarthAtmosphere().atmosphere)
    const profile = createEarthCloudProfile()
    try {
      const configured = {
        ...profile,
        layers: [{ ...profile.layers[0], detail: { ...profile.layers[0].detail, verticalProfileBias: 0.65 } }]
      }
      applyPlanetCloudLayer(clouds, configured)
      expect(clouds.cloudLayers[0].shapeAlteringBias).toBe(0.65)
      const legacy = structuredClone(configured)
      Reflect.deleteProperty(legacy.layers[0].detail, 'verticalProfileBias')
      applyPlanetCloudLayer(clouds, legacy)
      expect(clouds.cloudLayers[0].shapeAlteringBias).toBe(0.35)
    } finally {
      clouds.dispose()
    }
  })
  it('initializes both array targets before drawing and restores wrappers only once', () => {
    const clouds = createEarthClouds(new PerspectiveCamera(), createEarthAtmosphere().atmosphere)
    const order: string[] = []
    const passes = [clouds.shadowPass.currentPass, clouds.shadowPass.resolvePass]
    const spies = passes.map((pass, i) =>
      vi.spyOn(pass, 'render').mockImplementation(() => {
        order.push(`draw-${i}`)
      })
    )
    const restore = prepareCloudTargets(clouds)
    const renderer = { initRenderTarget: (target: unknown) => order.push(`init-${target}`) }
    passes.forEach((pass, i) => pass.render(renderer as never, null as never, i as never))
    expect(order).toEqual(['init-0', 'draw-0', 'init-1', 'draw-1'])
    restore()
    const replacement = () => {}
    passes[0].render = replacement
    restore()
    expect(passes[0].render).toBe(replacement)
    spies.forEach((spy) => spy.mockRestore())
    clouds.dispose()
  })
  it('uses one Earth shell and disables volume on orbit', () => {
    const profile = createEarthCloudProfile()
    expect(resolveCloudConfig(profile, new Set([24, 26, 27, 91])).state).toBe('configured')
    expect(profile.farAppearance).toBe('surface-map')
    expect(profile.layers).toHaveLength(1)
    expect(profile.layers[0].color).toEqual({ kind: 'constant', srgb: [1, 1, 1] })
    for (const [height, weight] of [
      [20000000, 0],
      [150000, 0],
      [110000, 0.5],
      [70000, 1],
      [6000, 1],
      [2000, 1]
    ]) {
      expect(cloudVolumeOpacity(cloudShellDistance(height, profile.layers), profile.lod)).toBeCloseTo(weight, 10)
    }
    profile.layers[0].detail.seed = 1
    expect(createEarthCloudProfile().layers[0].detail.seed).toBe(0x45617274)
  })
  it('converts only radii to metres and owns all mutable atmosphere values', () => {
    const row = RenderingObjects.find((entry) => entry.actorId === 47)!
    const before = structuredClone(row.data)
    const { config, atmosphere } = createEarthAtmosphere()
    expect(atmosphere.bottomRadius).toBe(6360000)
    expect(atmosphere.topRadius).toBe(6420000)
    const shader = atmosphere.toUniform().value
    expect(shader.bottom_radius).toBe(6360)
    expect(shader.top_radius).toBe(6420)
    expect(shader.rayleigh_scattering.toArray()).toEqual(config.rayleighScattering)
    expect(shader.mie_density.layers[1].exp_scale).toBe(config.mieDensity[1].expScale)
    const second = toTakramAtmosphere(config)
    atmosphere.rayleighDensity[1].expScale = -5
    atmosphere.rayleighScattering.x = 9
    atmosphere.groundAlbedo.r = 9
    expect(second.rayleighDensity[1].expScale).toBe(config.rayleighDensity[1].expScale)
    expect(second.rayleighScattering.toArray()).toEqual(config.rayleighScattering)
    expect(second.groundAlbedo.toArray()).toEqual(config.groundAlbedo)
    config.bottomRadius = 1
    expect(row.data).toEqual(before)
  })
  it('calculates Earth camera height in planet coordinates at a translated origin', () => {
    const camera = new PerspectiveCamera(60, 1, 1, 5e8)
    camera.position.set(1200, -400, 800)
    camera.updateMatrixWorld()
    const clouds = createEarthClouds(camera, createEarthAtmosphere().atmosphere)
    try {
      expect(clouds.ellipsoid.radii.toArray()).toEqual([6360000, 6360000, 6360000])
      expect(clouds.correctAltitude).toBe(false)
      clouds.worldToECEFMatrix.makeTranslation(-1200, 400, 6374200)
      clouds.cloudsPass.currentMaterial.copyCameraSettings(camera)
      expect(clouds.cloudsPass.currentMaterial.uniforms.cameraHeight.value).toBeCloseTo(15000, 5)
      const active = Array.from(clouds.cloudLayers).filter((layer) => layer.height > 0)
      expect(active).toHaveLength(1)
      expect(active[0]).toMatchObject({ altitude: 4000, height: 4000, densityScale: 1, shadow: true })
      expect(clouds.scatteringCoefficient).toBe(createEarthCloudProfile().layers[0].extinctionPerMeter)
      expect(clouds.absorptionCoefficient).toBe(0)
    } finally {
      clouds.dispose()
    }
  })
  it('preserves bound geography and physical density through quality round trips', () => {
    const profile = createEarthCloudProfile()
    const before = structuredClone(profile)
    const weather = new DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1, RGBAFormat)
    const maps: CloudAppearanceTextures = {
      weather,
      color: null,
      constantColorLinear: [1, 1, 1],
      colorStrength: 1,
      dispose() {}
    }
    const clouds = createEarthClouds(new PerspectiveCamera(), createEarthAtmosphere().atmosphere)
    const binding = bindCloudAppearance(clouds, profile, maps)
    binding.setPlanetRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6))
    const matrix = (clouds.cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet.value as Matrix3).clone()
    const seed = clouds.shapeOffset.clone(),
      detailSeed = clouds.shapeDetailOffset.clone()
    clouds.setSize(1920, 1080)
    try {
      for (const [quality, bufferSize, minStep, iterations, sunSteps] of [
        ['medium', [1344, 756], 50, 512, 2],
        ['low', [960, 540], 100, 256, 1],
        ['high', [1920, 1080], 25, 768, 4],
        ['medium', [1344, 756], 50, 512, 2]
      ] as const) {
        setEarthCloudQuality(clouds, quality)
        const { width, height } = clouds.cloudsPass.outputBuffer.image
        expect([width, height]).toEqual(bufferSize)
        expect(clouds.clouds).toMatchObject({
          minStepSize: minStep,
          maxStepSize: 1000,
          maxIterationCount: iterations,
          maxRayDistance: 2000000,
          perspectiveStepScale: 1.000001,
          minDensity: 1e-7,
          minExtinction: 1e-7,
          minSecondaryStepSize: 100,
          maxIterationCountToSun: sunSteps
        })
        expect(clouds.powderScale).toBe(0)
        expect(clouds.lightShafts).toBe(false)
        expect(clouds.haze).toBe(false)
        expect(clouds.turbulence).toBe(false)
        expect(clouds.shadow.maxFar).toBe(200000)
        const active = Array.from(clouds.cloudLayers).filter((layer) => layer.height > 0)
        expect(active).toHaveLength(1)
        expect(active[0]).toMatchObject({
          altitude: 4000,
          height: 4000,
          densityScale: 1,
          shapeDetailAmount: before.layers[0].detail.erosionStrength,
          shadow: true
        })
        expect(clouds.scatteringCoefficient).toBe(before.layers[0].extinctionPerMeter)
        expect(clouds.absorptionCoefficient).toBe(0)
        expect(clouds.shapeRepeat.x).toBe(1 / 12000)
        expect(clouds.shapeDetailRepeat.x).toBe(1 / 1200)
        expect(clouds.shapeOffset).toEqual(seed)
        expect(clouds.shapeDetailOffset).toEqual(detailSeed)
        expect(seed.length()).toBeGreaterThan(0)
        expect(clouds.localWeatherTexture).toBe(weather)
        for (const pass of [clouds.cloudsPass, clouds.shadowPass]) {
          expect(pass.currentMaterial.uniforms.cloudECEFToPlanet.value).toEqual(matrix)
          expect(pass.currentMaterial.uniforms.cloudLongitudeOffset.value).toBe(0)
        }
        expect(profile).toEqual(before)
      }
    } finally {
      binding.dispose()
      weather.dispose()
      clouds.dispose()
    }
  })
})
