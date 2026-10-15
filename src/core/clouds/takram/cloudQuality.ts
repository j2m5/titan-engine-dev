import type { CloudsEffect } from '@takram/three-clouds'
import type { CloudQualityProfile, CloudQuality } from '@/core/clouds/SceneCloudConfig'

export function setCloudQuality(clouds: CloudsEffect, profile: CloudQualityProfile, quality: CloudQuality): void {
  if (profile === 'terrestrial') {
    clouds.qualityPreset = quality
    const values = {
      low: { resolution: 0.65, minStep: 100, iterations: 256, sunSteps: 1 },
      medium: { resolution: 0.8, minStep: 50, iterations: 512, sunSteps: 2 },
      high: { resolution: 1, minStep: 25, iterations: 768, sunSteps: 4 }
    }[quality]
    clouds.resolutionScale = values.resolution
    Object.assign(clouds.clouds, {
      minStepSize: values.minStep,
      maxStepSize: 1000,
      maxIterationCount: values.iterations,
      maxRayDistance: 2000000,
      perspectiveStepScale: 1.000001,
      minDensity: 1e-7,
      minExtinction: 1e-7,
      minSecondaryStepSize: 100,
      maxIterationCountToSun: values.sunSteps
    })
    clouds.lightShafts = false
    clouds.haze = false
    clouds.turbulence = false
    // The inherited powder exponent is not calibrated for Earth's per-metre extinction.
    clouds.powderScale = 0
    clouds.shadow.maxFar = 200000
  } else {
    clouds.qualityPreset = quality
    // The terrestrial defaults cap the march at 100–200 km. Orbit is much farther away.
    clouds.clouds.maxRayDistance = 5e8
    clouds.clouds.maxIterationCount = quality === 'low' ? 128 : quality === 'medium' ? 256 : 384
    clouds.clouds.minStepSize = quality === 'low' ? 800 : quality === 'medium' ? 400 : 200
    clouds.resolutionScale = quality === 'low' ? 0.65 : quality === 'medium' ? 0.8 : 1
    clouds.clouds.maxStepSize = 4000
    // Upstream grows the FIRST step with camera-to-shell distance (90,000 km in the orbit preset).
    // Its terrestrial 1.01 factor skips our entire 20 km shell before taking the first sample.
    clouds.clouds.perspectiveStepScale = 1.000001
    clouds.clouds.minDensity = 1e-7
    clouds.clouds.minExtinction = 1e-7
    clouds.clouds.minSecondaryStepSize = 1000
    clouds.clouds.maxIterationCountToSun = quality === 'high' ? 4 : 2
    clouds.lightShafts = false
    clouds.haze = false
    clouds.turbulence = false
    clouds.shadow.maxFar = 200000
  }
}
