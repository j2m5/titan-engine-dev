import { DataTexture, RGBAFormat, Vector3 } from 'three'
import { adaptEarthCloudLightingShader } from '@/labs/earth-clouds/earthCloudLighting'
import { createGpuReadback, type EarthGpuProbeReport } from './gpuTestHarness'

/** Independent nonuniform Lambert references exercise the production GLSL conversion. */
export async function checkEarthCloudLighting(): Promise<EarthGpuProbeReport> {
  const gpu = createGpuReadback()
  const report: EarthGpuProbeReport = { name: 'earth-cloud-lighting', checks: 0, maxError: 0, resourcesReleased: false }
  const solar = new Vector3(2, 3, 4),
    conversion = new Vector3(0.8, 1.2, 0.9)
  const texture = new DataTexture(new Uint8Array([128, 200, 150, 255]), 1, 1, RGBAFormat)
  texture.needsUpdate = true
  const original = `
    const float PI = 3.141592653589793;
    struct ReferenceAtmosphere { vec3 solar_irradiance; };
    uniform ReferenceAtmosphere ATMOSPHERE;
    uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE, expectedZenith;
    uniform sampler2D transmittance_texture;
    vec3 GetTransmittanceToSun(ReferenceAtmosphere atmosphere, sampler2D map, float radius, float mu) {
      return texture2D(map, vec2(radius / 12720.0, mu * .5)).rgb;
    }
    float remapClamped(float v, float lo, float hi) { return clamp((v-lo)/(hi-lo),0.,1.); }
    vec4 marchReference() {
      vec3 radianceIntegral = ATMOSPHERE.solar_irradiance * SUN_SPECTRAL_RADIANCE_TO_LUMINANCE * expectedZenith / PI;
      float transmittanceIntegral = .3, minTransmittance = .001;
      return vec4(radianceIntegral, remapClamped(transmittanceIntegral, 1.0, minTransmittance));
    }`
  const transformed = adaptEarthCloudLightingShader(original)
  const run = (source: string, expectedZenith: Vector3) =>
    gpu.run('vec4 result=marchReference(); gl_FragColor=vec4(result.rgb*.25,result.a);', source, {
      ATMOSPHERE: { value: { solar_irradiance: solar } },
      SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: { value: conversion },
      expectedZenith: { value: expectedZenith },
      transmittance_texture: { value: texture },
      earthLightingDatumKm: { value: 6360 }
    })
  try {
    for (const bytes of [
      [128, 200, 150],
      [0, 100, 240]
    ]) {
      ;(texture.image.data as Uint8Array).set([...bytes, 255])
      texture.needsUpdate = true
      const zenith = new Vector3(...(bytes.map((value) => Math.max(value / 255, 0.001)) as [number, number, number]))
      const once = run(transformed, zenith)
      for (let channel = 0; channel < 3; channel++) {
        const error = Math.abs(once[channel] - 0.25)
        if (error > 2 / 255) throw new Error(`Converted Lambert reference is not white: ${once}`)
        report.maxError = Math.max(report.maxError, error)
        report.checks++
      }
      const omitted = run(original, zenith)
      const doubled = run(
        transformed.replace(
          'radianceIntegral /= earthCloudReferenceWhite;',
          'radianceIntegral /= earthCloudReferenceWhite; radianceIntegral /= earthCloudReferenceWhite;'
        ),
        zenith
      )
      if (
        Math.max(...omitted.slice(0, 3).map((value) => Math.abs(value - 0.25))) < 0.05 ||
        Math.max(...doubled.slice(0, 3).map((value) => Math.abs(value - 0.25))) < 0.05
      )
        throw new Error('Reference negative controls failed to reject missing/double conversion')
      report.checks += 2
      if (once[3] !== omitted[3] || once[3] !== doubled[3]) throw new Error('Reference conversion changed alpha')
      report.checks++
    }
  } finally {
    texture.dispose()
    report.resourcesReleased = gpu.dispose()
  }
  return report
}
