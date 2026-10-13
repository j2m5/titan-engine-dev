import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import {
  createJupiterAtmosphere,
  createJupiterClouds,
  setJupiterCloudQuality
} from '@/labs/jupiter-clouds/JupiterCloudAdapter'

describe('Jupiter cloud adapter', () => {
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
