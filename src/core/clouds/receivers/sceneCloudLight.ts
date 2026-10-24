/** Snapshot of the current far receiver's authored lighting policy, not new settings. */
export interface SceneCloudLightSettings {
  ambient: number
  ambientSunRef: number
  sunTintEnabled: boolean
  skyAmbientEnabled: boolean
  sunTintStrength: number
  skyAmbientStrength: number
  bottomRadiusKm: number
  topRadiusKm: number
  datumRadiusKm: number
  sunAngularRadius: number
}

/** Shared by the far map and calibrated terrestrial source light. Eclipse is applied by their caller. */
export const sceneCloudLightGLSL = `
const float sceneCloudSunRampStart = -0.08;
vec3 sceneCloudSkyLight(float muS, vec3 tint, float ambientSunRef, vec3 skyTint, float skyStrength) {
  vec3 sky = clamp(muS / max(ambientSunRef, 1e-3), 0.0, 1.0) * tint;
  return mix(sky, skyTint, skyStrength);
}
void sceneCloudSplitLight(float muS, vec3 tint, vec3 sky, vec3 lightColor,
  float lambert, float ambientSetting, out vec3 direct, out vec3 ambient) {
  float sun = max(muS, 0.0);
  direct = tint * lightColor * mix(smoothstep(sceneCloudSunRampStart, 0.25, muS), sun, lambert);
  ambient = lambert * ambientSetting * sky * (1.0 - sun);
}
`
