import type { CloudsEffect } from '@takram/three-clouds'
import { Uniform } from 'three'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

const returnAnchor = 'return vec4(radianceIntegral, remapClamped(transmittanceIntegral, 1.0, minTransmittance));'
const installed = new WeakSet<object>()

/** Match the normalized surface white before the cloud's separate aerial perspective. */
export function adaptEarthCloudLightingShader(source: string): string {
  if (source.includes('earthCloudReferenceWhite') || source.includes('earthLightingDatumKm'))
    throw new Error('Earth cloud lighting already installed')
  const shader = replaceExactlyOnce(
    source,
    returnAnchor,
    `vec3 earthCloudReferenceWhite = ATMOSPHERE.solar_irradiance
    * SUN_SPECTRAL_RADIANCE_TO_LUMINANCE
    * max(GetTransmittanceToSun(ATMOSPHERE, transmittance_texture,
        earthLightingDatumKm, 1.0), vec3(1e-3)) / PI;
  radianceIntegral /= earthCloudReferenceWhite;
  ${returnAnchor}`,
    'Earth cloud lighting',
    'integrated return'
  )
  return 'uniform highp float earthLightingDatumKm;\n' + shader
}

export function bindEarthCloudLighting(clouds: CloudsEffect, datumRadiusMeters: number): () => void {
  if (!Number.isFinite(datumRadiusMeters) || datumRadiusMeters <= 0)
    throw new RangeError('Invalid Earth lighting datum radius')
  const material = clouds.cloudsPass.currentMaterial
  if (installed.has(material)) throw new Error('Earth cloud lighting already installed')
  const original = material.fragmentShader
  const shader = adaptEarthCloudLightingShader(original)
  const hadUniform = Object.prototype.hasOwnProperty.call(material.uniforms, 'earthLightingDatumKm')
  const previousUniform = material.uniforms.earthLightingDatumKm
  material.fragmentShader = shader
  material.uniforms.earthLightingDatumKm = new Uniform(datumRadiusMeters / 1000)
  material.needsUpdate = true
  installed.add(material)
  let restored = false
  return () => {
    if (restored) return
    restored = true
    material.fragmentShader = original
    if (hadUniform) material.uniforms.earthLightingDatumKm = previousUniform
    else delete material.uniforms.earthLightingDatumKm
    material.needsUpdate = true
    installed.delete(material)
  }
}
