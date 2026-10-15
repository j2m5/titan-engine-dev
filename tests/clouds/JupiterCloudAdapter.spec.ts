import { describe, expect, it } from 'vitest'
import {
  PerspectiveCamera,
  Texture,
  Vector2,
  RepeatWrapping,
  DataTexture,
  RGBAFormat,
  Quaternion,
  Vector3,
  Matrix3
} from 'three'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { prepareCloudAppearanceTextures } from '@/core/clouds/appearance/cloudAppearanceTextures'
import { bindCloudAppearance } from '@/core/clouds/appearance/cloudAppearance'
import {
  createJupiterAtmosphere,
  createJupiterClouds,
  setJupiterCloudQuality,
  createCloudSurfaceView
} from '@/labs/jupiter-clouds/JupiterCloudAdapter'

describe('Jupiter cloud adapter', () => {
  it('keeps configured geometry, physical density and seeded geography through quality changes', () => {
    const profile = createJupiterCloudProfile()
    const layer = profile.layers[0]
    const source = new DataTexture(new Uint8Array([180, 140, 100, 255]), 1, 1, RGBAFormat)
    const maps = prepareCloudAppearanceTextures(layer, () => source)
    const clouds = createJupiterClouds(new PerspectiveCamera(), createJupiterAtmosphere().atmosphere)
    const binding = bindCloudAppearance(clouds, profile, maps)
    binding.setPlanetRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6))
    const matrix = (clouds.cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet.value as Matrix3).clone()
    const seed = clouds.shapeOffset.clone(),
      detailSeed = clouds.shapeDetailOffset.clone()
    try {
      for (const quality of ['medium', 'low', 'high', 'medium'] as const) {
        setJupiterCloudQuality(clouds, quality)
        const active = Array.from(clouds.cloudLayers).filter((entry) => entry.height > 0)
        expect(active).toHaveLength(1)
        expect(active[0].altitude).toBe(layer.baseAltitudeMeters)
        expect(active[0].height).toBe(layer.thicknessMeters)
        expect(active[0].shadow).toBe(layer.castsShadow)
        expect(clouds.scatteringCoefficient).toBe(layer.extinctionPerMeter)
        expect(clouds.shapeRepeat.x).toBe(1 / layer.detail.shapeScaleMeters)
        expect(clouds.shapeDetailRepeat.x).toBe(1 / layer.detail.erosionScaleMeters)
        expect(clouds.shapeOffset).toEqual(seed)
        expect(clouds.shapeDetailOffset).toEqual(detailSeed)
        expect(seed.length()).toBeGreaterThan(0)
        expect(clouds.localWeatherTexture).toBe(maps.weather)
        expect(clouds.cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet.value).toEqual(matrix)
        expect(clouds.shadowPass.currentMaterial.uniforms.cloudECEFToPlanet.value).toEqual(matrix)
      }
    } finally {
      binding.dispose()
      maps.dispose()
      source.dispose()
      clouds.dispose()
    }
  })
  it('aligns the owned surface view with longitude-offset map sampling without mutating its source', () => {
    const source = new Texture()
    source.offset.set(0.03, 0.07)
    source.repeat.set(0.5, 0.7)
    source.rotation = 0.3
    source.matrixAutoUpdate = false
    source.updateMatrix()
    const sourceMatrix = source.matrix.clone()
    const view = createCloudSurfaceView(source, Math.PI / 2)
    expect(view).not.toBe(source)
    expect(view.source).not.toBe(source.source)
    expect(view.image).toBe(source.image)
    expect(source.offset.toArray()).toEqual([0.03, 0.07])
    expect(view.wrapS).toBe(RepeatWrapping)
    expect(source.matrix).toEqual(sourceMatrix)
    expect(source.repeat.toArray()).toEqual([0.5, 0.7])
    expect(source.rotation).toBe(0.3)
    expect(source.matrixAutoUpdate).toBe(false)
    const uv = new Vector2(0.9, 0.4)
    view.transformUv(uv)
    expect(uv.x).toBeCloseTo(0.15)
    view.dispose()
    source.dispose()
  })
  it('replaces all terrestrial layers with one Jupiter layer', () => {
    const { atmosphere } = createJupiterAtmosphere()
    const clouds = createJupiterClouds(new PerspectiveCamera(), atmosphere)
    try {
      const activeLayers = Array.from(clouds.cloudLayers).filter((layer) => layer.height > 0)
      expect(activeLayers).toHaveLength(1)
      expect(activeLayers[0].altitude).toBe(10000)
      expect(activeLayers[0].height).toBe(20000)
    } finally {
      clouds.dispose()
    }
  })
  it('converts planet radii to metres while keeping the atmosphere shader in kilometres', () => {
    const { config, atmosphere } = createJupiterAtmosphere()
    expect(atmosphere.bottomRadius).toBe(69911000)
    expect(atmosphere.topRadius).toBe(73232000)
    const shader = atmosphere.toUniform().value
    expect(shader.bottom_radius).toBe(69911)
    expect(shader.top_radius).toBe(73232)
    expect(shader.rayleigh_scattering.toArray()).toEqual(config.rayleighScattering)
    expect(shader.mie_density.layers[1].exp_scale).toBe(config.mieDensity[1].expScale)
    atmosphere.rayleighDensity[1].expScale = -5
    expect(config.rayleighDensity[1].expScale).not.toBe(-5)
  })

  it.each([15000, 100000, 70000000])('uses Jupiter altitude at %i metres above the datum', (height) => {
    const { atmosphere } = createJupiterAtmosphere()
    const camera = new PerspectiveCamera(60, 1, 1, 5e8)
    camera.position.set(0, 0, 69911000 + height)
    camera.updateMatrixWorld()
    const clouds = createJupiterClouds(camera, atmosphere)
    try {
      clouds.cloudsPass.currentMaterial.copyCameraSettings(camera)
      expect(clouds.cloudsPass.currentMaterial.uniforms.cameraHeight.value).toBeCloseTo(height, 5)
    } finally {
      clouds.dispose()
    }
  })

  it('calculates height in planet coordinates when the rendering origin is translated', () => {
    const { atmosphere } = createJupiterAtmosphere()
    const camera = new PerspectiveCamera(60, 1, 1, 5e8)
    camera.position.set(1200, -400, 800)
    camera.updateMatrixWorld()
    const clouds = createJupiterClouds(camera, atmosphere)
    try {
      clouds.worldToECEFMatrix.makeTranslation(-1200, 400, 69925200)
      clouds.cloudsPass.currentMaterial.copyCameraSettings(camera)
      expect(clouds.cloudsPass.currentMaterial.uniforms.cameraHeight.value).toBeCloseTo(15000, 5)
    } finally {
      clouds.dispose()
    }
  })

  it('keeps the ray distance large enough for orbit after changing quality', () => {
    const { atmosphere } = createJupiterAtmosphere()
    const camera = new PerspectiveCamera(60, 1, 1, 5e8)
    const clouds = createJupiterClouds(camera, atmosphere)
    try {
      for (const quality of ['low', 'high', 'medium'] as const) {
        setJupiterCloudQuality(clouds, quality)
        expect(clouds.clouds.maxRayDistance).toBeGreaterThan(2 * atmosphere.topRadius)
        expect(clouds.lightShafts).toBe(false)
        expect(clouds.haze).toBe(false)
      }
    } finally {
      clouds.dispose()
    }
  })
})
