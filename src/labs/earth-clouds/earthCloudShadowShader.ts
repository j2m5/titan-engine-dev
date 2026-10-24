import { buildSceneCloudShadowGLSL } from '@/core/clouds/receivers/sceneCloudShadowShader'

/** Lab-specific coordinate adapter; guarded pinned sampler is shared with main-scene receivers. */
export function buildEarthCloudShadowGLSL(reference: string): string {
  return (
    // This lab owns its standalone shadow closure; it has no main-scene near branch.
    '#define EARTH_SHADOW_RECEIVER\n' +
    buildSceneCloudShadowGLSL(reference)
      .replace(/\bSCENE_CLOUD_NEAR\b/g, 'EARTH_SHADOW_RECEIVER')
      .replace(/sceneCloudShadow/g, 'earthShadow')
      .replace(/SCENE_CLOUD_SHADOW/g, 'EARTH_SHADOW') +
    `
    uniform mat4 earthWorldToECEF;
    float earthSampleSunTransmittance(vec3 worldPosition) {
      if (!earthShadowEnabled) return 1.0;
      vec3 positionECEFkm = (earthWorldToECEF * vec4(worldPosition, 1.0)).xyz * 0.001;
      float radius = earthShadowGetShadowRadius(worldPosition);
      return exp(-earthShadowSampleShadowOpticalDepth(worldPosition, positionECEFkm, radius, earthShadowGetSTBN()));
    }
    #undef EARTH_SHADOW_RECEIVER`
  )
}
