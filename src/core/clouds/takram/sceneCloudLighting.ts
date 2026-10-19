import type { CloudsEffect } from '@takram/three-clouds'
import { Vector3, Vector4 } from 'three'
import { MAX_OCCLUDERS } from '@/core/eclipse/eclipseMath'
import { eclipseFunctions } from '@/core/materials/shaders/lib/chunks/Eclipse'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { SceneCloudDepthFrame } from '@/core/graphic/clouds/SceneCloudDepth'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { adaptSceneCloudAerial, sceneCloudAerialUniformsGlsl } from './sceneCloudAerial'
import { sceneCloudLightGLSL } from '@/core/clouds/receivers/sceneCloudLight'
import { sunTransmittanceFunctions } from '@/core/materials/shaders/lib/chunks/SunTransmittance'
import { adaptSceneCloudTemporalResolve } from './sceneCloudTemporal'
import { adaptSceneCloudSunShadow } from './sceneCloudSunShadow'

export function cloudLightScale(
  irradiance: readonly [number, number, number],
  sunToLuminance: readonly [number, number, number],
  zenithTransmittance: readonly [number, number, number],
  targetWhite: readonly [number, number, number]
): [number, number, number] {
  return irradiance.map((light, channel) => {
    const coefficient = sunToLuminance[channel]
    const transmittance = zenithTransmittance[channel]
    const target = targetWhite[channel]
    if (
      !Number.isFinite(light) ||
      light <= 0 ||
      !Number.isFinite(coefficient) ||
      coefficient <= 0 ||
      !Number.isFinite(transmittance) ||
      transmittance < 0 ||
      !Number.isFinite(target) ||
      target < 0
    )
      throw new Error(`Scene cloud light conversion: invalid channel ${channel}`)
    const scale = (target * Math.PI) / (light * coefficient * Math.max(transmittance, 1e-3))
    if (!Number.isFinite(scale)) throw new Error(`Scene cloud light conversion: nonfinite scale in channel ${channel}`)
    return scale
  }) as [number, number, number]
}

const installed = new WeakSet<CloudsEffect>()

export interface SceneCloudPatchBinding {
  update(frame: CloudFrame, depth: SceneCloudDepthFrame, atmosphere: AtmosphereEntry): void
  dispose(): void
}

/** Validate every anchor before publishing an instance shader or uniforms. */
export function installSceneCloudPatches(clouds: CloudsEffect, sceneReferenceLighting = false): SceneCloudPatchBinding {
  if (installed.has(clouds)) throw new Error('Scene cloud patches already installed')
  const material = clouds.cloudsPass.currentMaterial
  const originalShader = material.fragmentShader
  const originalUniforms = { ...material.uniforms }
  const resolveMaterial = clouds.cloudsPass.resolveMaterial
  const originalResolveShader = resolveMaterial.fragmentShader
  const resolveShader = adaptSceneCloudTemporalResolve(originalResolveShader)
  let shader = replaceExactlyOnce(
    originalShader,
    /float getRayDistanceToScene\([^]*?\n\}/g,
    `
float getRayDistanceToScene(const vec3 rayDirection, out float viewZ) {
  float depth = readDepthValue(depthBuffer, vUv * targetUvScale + temporalJitter);
  if (depth >= 1.0 - 1e-7) { viewZ = -1e30; return 1e30; }
  float distanceMeters = (exp2(depth * sceneCloudLogFarFactor) - 1.0) * sceneCloudUnitsToMeters;
  viewZ = -distanceMeters;
  return distanceMeters / max(dot(rayDirection, vCameraDirection), 1e-6);
}`,
    'scene cloud',
    'getRayDistanceToScene'
  )
  const integratedReturn = 'return vec4(radianceIntegral, remapClamped(transmittanceIntegral, 1.0, minTransmittance));'
  if (!sceneReferenceLighting)
    shader = replaceExactlyOnce(
      shader,
      integratedReturn,
      `
vec3 sceneCloudTargetWhite = clamp(mix(vec3(1.0), sceneCloudLightColor, sceneCloudLambert), vec3(0.0), vec3(.99));
vec3 sceneCloudReferenceWhite = ATMOSPHERE.solar_irradiance * SUN_SPECTRAL_RADIANCE_TO_LUMINANCE
  * max(GetTransmittanceToSun(ATMOSPHERE, transmittance_texture, sceneCloudDatumKm, 1.0), vec3(1e-3)) / PI;
radianceIntegral *= sceneCloudTargetWhite / sceneCloudReferenceWhite;
${integratedReturn}`,
      'scene cloud',
      'integrated radiance'
    )
  const sunAssignment = 'vec3 sunIrradiance = getCloudsSunSkyIrradiance(position, height, skyIrradiance);'
  const eclipse = (point: string): string => `sunIrradiance *= eclipseLightAt(${point}, sceneCloudEclipseCount,
    sceneCloudEclipseOcc, sceneCloudEclipseStar, sceneCloudEclipseStarRadius, sceneCloudEclipseUmbra);`
  shader = replaceExactlyOnce(
    shader,
    sunAssignment,
    `${sunAssignment}\n${eclipse('position * .001')}`,
    'scene cloud',
    'direct eclipse'
  )
  const groundAssignment =
    'vec3 sunIrradiance = getGroundSunSkyIrradiance(position, surfaceNormal, height, skyIrradiance);'
  shader = replaceExactlyOnce(
    shader,
    groundAssignment,
    `${groundAssignment}\n${eclipse('(position - surfaceNormal * height) * .001')}`,
    'scene cloud',
    'ground eclipse'
  )
  if (sceneReferenceLighting) {
    shader = adaptSceneCloudSunShadow(shader)
    shader = replaceExactlyOnce(
      shader,
      'vec3 radianceIntegral = vec3(0.0);',
      'vec3 radianceIntegral = vec3(0.0);\nfloat sceneCloudUnshadowedPhase = max(approximateMultipleScattering(0.0, cosTheta), 1e-6);',
      'scene cloud',
      'unshadowed source phase'
    )
    shader = replaceExactlyOnce(
      shader,
      'vec3 radiance = sunIrradiance * approximateMultipleScattering(opticalDepth, cosTheta);',
      'vec3 radiance = vec3(0.0);',
      'scene cloud',
      'scene-linear source declaration'
    )
    shader = replaceExactlyOnce(
      shader,
      '#ifdef GROUND_BOUNCE\n      // Fudge factor for the irradiance from ground.',
      '#if 0\n      // Scene-reference ambient is the sole indirect term; no physical-unit ground bounce.',
      'scene cloud',
      'scene-linear indirect policy'
    )
    shader = replaceExactlyOnce(
      shader,
      'radiance += skyIrradiance * RECIPROCAL_PI4 * skyGradient * skyLightScale;',
      `radiance = sceneCloudReferenceLight(dot(surfaceNormal, sunDirection),
        approximateMultipleScattering(opticalDepth, cosTheta) / sceneCloudUnshadowedPhase, skyGradient,
        eclipseLightAt(position * .001, sceneCloudEclipseCount, sceneCloudEclipseOcc,
          sceneCloudEclipseStar, sceneCloudEclipseStarRadius, sceneCloudEclipseUmbra));`,
      'scene cloud',
      'scene-linear source integration'
    )
    shader = replaceExactlyOnce(
      shader,
      'vec4 marchClouds(',
      `
vec3 sceneCloudReferenceLight(float muS, float sunAttenuation, float skyGradient, vec3 visibility) {
  vec3 tint = vec3(1.0);
  if (sceneCloudSourceSunTint) tint = mix(vec3(1.0), sunTint(muS), sceneCloudSourceSunStrength);
  vec3 skyTint = vec3(0.0);
  float skyStrength = sceneCloudSourceSunTint && sceneCloudSourceSkyAmbient && sceneCloudSourceSkyStrength > 0.0
    ? sceneCloudSourceSkyStrength : 0.0;
  if (skyStrength > 0.0) skyTint = skyAmbientTint(muS);
  vec3 sky = sceneCloudSkyLight(muS, tint, sceneCloudSourceAmbientSunRef, skyTint, skyStrength);
  vec3 direct, ambient;
  sceneCloudSplitLight(muS, tint, sky, sceneCloudLightColor, sceneCloudLambert, sceneCloudSourceAmbient, direct, ambient);
  return visibility * (direct * sunAttenuation + ambient * skyGradient * skyLightScale);
}
vec4 marchClouds(`,
      'scene cloud',
      'scene-reference source light'
    )
  }
  shader = adaptSceneCloudAerial(shader)
  const sourceUniformsGlsl = `
uniform bool sceneCloudSourceSunTint, sceneCloudSourceSkyAmbient;
uniform float sceneCloudSourceAmbient, sceneCloudSourceAmbientSunRef;
uniform float sceneCloudSourceSunStrength, sceneCloudSourceSkyStrength;
uniform float sceneCloudSourceBottomKm, sceneCloudSourceTopKm, sceneCloudSourceDatumKm, sceneCloudSourceSunAngularRadius;
`
  // Borrow the existing LUT samplers, with the far owner's exact geometry. No new samplers.
  let sourceTintFunctions = sunTransmittanceFunctions
  for (const [from, to] of Object.entries({
    uAtmoTransmittance: 'transmittance_texture',
    uAtmoIrradiance: 'irradiance_texture',
    uAtmoBottomRadius: 'sceneCloudSourceBottomKm',
    uAtmoTopRadius: 'sceneCloudSourceTopKm',
    uAtmoDatumRadius: 'sceneCloudSourceDatumKm',
    uAtmoSunAngularRadius: 'sceneCloudSourceSunAngularRadius'
  }))
    sourceTintFunctions = sourceTintFunctions.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
  sourceTintFunctions = sourceTintFunctions.replace(/\btexture2D\b/g, 'texture')
  const header = `
uniform float sceneCloudLogFarFactor;
uniform float sceneCloudUnitsToMeters;
uniform float sceneCloudDatumKm;
uniform vec3 sceneCloudLightColor;
uniform float sceneCloudLambert;
uniform int sceneCloudEclipseCount;
uniform vec4 sceneCloudEclipseOcc[4];
uniform vec3 sceneCloudEclipseStar;
uniform float sceneCloudEclipseStarRadius;
uniform vec4 sceneCloudEclipseUmbra[4];
${sceneCloudAerialUniformsGlsl}
${eclipseFunctions}
${sceneReferenceLighting ? sourceUniformsGlsl + sourceTintFunctions + sceneCloudLightGLSL : ''}
`
  shader = replaceExactlyOnce(
    shader,
    'uniform sampler2D depthBuffer;',
    header + '\nuniform sampler2D depthBuffer;',
    'scene cloud',
    'uniform declaration'
  )
  const sourceUniforms = {
    sceneCloudSourceSunTint: { value: false },
    sceneCloudSourceSkyAmbient: { value: false },
    sceneCloudSourceAmbient: { value: 0 },
    sceneCloudSourceAmbientSunRef: { value: 1 },
    sceneCloudSourceSunStrength: { value: 0 },
    sceneCloudSourceSkyStrength: { value: 0 },
    sceneCloudSourceBottomKm: { value: 1 },
    sceneCloudSourceTopKm: { value: 2 },
    sceneCloudSourceDatumKm: { value: 1 },
    sceneCloudSourceSunAngularRadius: { value: 0 }
  }
  const uniforms = {
    sceneCloudLogFarFactor: { value: 1 },
    sceneCloudUnitsToMeters: { value: 1 },
    sceneCloudDatumKm: { value: 1 },
    sceneCloudLightColor: { value: new Vector3(1, 1, 1) },
    sceneCloudLambert: { value: 1 },
    sceneCloudEclipseCount: { value: 0 },
    sceneCloudEclipseOcc: { value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4()) },
    sceneCloudEclipseStar: { value: new Vector3() },
    sceneCloudEclipseStarRadius: { value: 0 },
    sceneCloudEclipseUmbra: { value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4()) },
    sceneCloudAtmosphereExposure: { value: 1 },
    sceneCloudAtmosphereHdrKnee: { value: 1 },
    ...(sceneReferenceLighting ? sourceUniforms : {})
  }
  material.fragmentShader = shader
  Object.assign(material.uniforms, uniforms)
  material.needsUpdate = true
  resolveMaterial.fragmentShader = resolveShader
  resolveMaterial.needsUpdate = true
  installed.add(clouds)
  let disposed = false
  return {
    update(frame, depth, atmosphere) {
      if (disposed) throw new Error('Scene cloud patch binding is disposed')
      uniforms.sceneCloudLogFarFactor.value = depth.sceneLogFarFactor
      uniforms.sceneCloudUnitsToMeters.value = depth.sceneUnitsToMeters
      uniforms.sceneCloudDatumKm.value = frame.datumRadiusMeters * 0.001
      uniforms.sceneCloudLightColor.value.set(frame.lightColor.r, frame.lightColor.g, frame.lightColor.b)
      uniforms.sceneCloudLambert.value = frame.lambert
      if (sceneReferenceLighting) {
        const light = frame.sceneLight
        if (!light) throw new Error('Scene-reference cloud light requires its current far owner snapshot')
        sourceUniforms.sceneCloudSourceSunTint.value = light.sunTintEnabled
        sourceUniforms.sceneCloudSourceSkyAmbient.value = light.skyAmbientEnabled
        sourceUniforms.sceneCloudSourceAmbient.value = light.ambient
        sourceUniforms.sceneCloudSourceAmbientSunRef.value = light.ambientSunRef
        sourceUniforms.sceneCloudSourceSunStrength.value = light.sunTintStrength
        sourceUniforms.sceneCloudSourceSkyStrength.value = light.skyAmbientStrength
        sourceUniforms.sceneCloudSourceBottomKm.value = light.bottomRadiusKm
        sourceUniforms.sceneCloudSourceTopKm.value = light.topRadiusKm
        sourceUniforms.sceneCloudSourceDatumKm.value = light.datumRadiusKm
        sourceUniforms.sceneCloudSourceSunAngularRadius.value = light.sunAngularRadius
      }
      uniforms.sceneCloudAtmosphereExposure.value = atmosphere.config.exposure ?? 10
      uniforms.sceneCloudAtmosphereHdrKnee.value = Math.max(0, atmosphere.config.hdrKnee ?? 1)
      const e = atmosphere.eclipse
      uniforms.sceneCloudEclipseCount.value = e ? Math.min(e.count, MAX_OCCLUDERS) : 0
      uniforms.sceneCloudEclipseStar.value.copy(e?.star ?? new Vector3())
      uniforms.sceneCloudEclipseStarRadius.value = e?.starRadius ?? 0
      for (let i = 0; i < MAX_OCCLUDERS; i++) {
        uniforms.sceneCloudEclipseOcc.value[i].copy(e?.occluders[i] ?? new Vector4())
        uniforms.sceneCloudEclipseUmbra.value[i].copy(e?.umbra[i] ?? new Vector4())
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      material.fragmentShader = originalShader
      resolveMaterial.fragmentShader = originalResolveShader
      resolveMaterial.needsUpdate = true
      for (const name of Object.keys(uniforms)) {
        if (name in originalUniforms) material.uniforms[name] = originalUniforms[name]
        else delete material.uniforms[name]
      }
      material.needsUpdate = true
      installed.delete(clouds)
    }
  }
}
