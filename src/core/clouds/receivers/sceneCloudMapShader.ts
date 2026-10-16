import { rgbCloudMapGLSL } from '@/core/clouds/appearance/rgbCloudMap'

/** Camera-relative inputs project water and its seabed onto one datum and one coverage. */
export const sceneCloudMapGLSL = `
uniform bool sceneCloudFarEnabled, sceneCloudHasFrame;
uniform sampler2D sceneCloudMap, sceneCloudColorMap;
uniform bool sceneCloudMappedColor;
uniform float sceneCloudColorStrength;
uniform mat4 sceneCloudViewToLocal, sceneCloudLocalToPlanet;
uniform float sceneCloudUnitsToMeters, sceneCloudDatumRadiusMeters, sceneCloudLongitudeOffset;
uniform vec3 sceneCloudCameraMeters, sceneCloudSunDirection, sceneCloudLightColor, sceneCloudColor;
uniform float sceneCloudLambert, sceneCloudAmbient, sceneCloudAmbientSunRef;
uniform int sceneCloudEncoding, sceneCloudChannel;
uniform vec2 sceneCloudInputRange;
uniform float sceneCloudExponent;
uniform bool sceneCloudInvert, sceneCloudEncodedScalar;
${rgbCloudMapGLSL}

vec3 sceneCloudPositionMeters(vec3 viewPositionSceneUnits) {
  return (sceneCloudViewToLocal * vec4(viewPositionSceneUnits * sceneCloudUnitsToMeters, 1.0)).xyz;
}
vec3 sceneCloudDatumDirection(vec3 viewPositionSceneUnits, vec3 radialFallback) {
  if (!sceneCloudHasFrame) return normalize(radialFallback);
  vec3 ray = normalize(mat3(sceneCloudViewToLocal) * viewPositionSceneUnits);
  float b = dot(sceneCloudCameraMeters, ray);
  float c = dot(sceneCloudCameraMeters, sceneCloudCameraMeters) - sceneCloudDatumRadiusMeters * sceneCloudDatumRadiusMeters;
  float discriminant = b * b - c;
  if (discriminant < 0.0) return normalize(radialFallback);
  float root = sqrt(discriminant);
  float t = -b - root;
  if (t < 0.0) t = -b + root;
  if (t < 0.0) return normalize(radialFallback);
  return normalize(mat3(sceneCloudLocalToPlanet) * (sceneCloudCameraMeters + ray * t));
}
vec3 sceneCloudLinearToSrgb(vec3 x) {
  return mix(12.92 * x, 1.055 * pow(max(x, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
}
vec3 sceneCloudFarComposite(vec3 baseColor, vec3 viewPositionSceneUnits, vec3 radialFallback, vec3 sunFallback) {
  #if !defined(SCENE_CLOUD_NEAR) && defined(SCENE_CLOUD_FAR_MAP)
  if (!sceneCloudFarEnabled) return baseColor;
  vec3 direction = sceneCloudDatumDirection(viewPositionSceneUnits, radialFallback);
  float phi = dot(direction.xz, direction.xz) > 1e-12 ? atan(direction.z, -direction.x) : 0.0;
  vec2 uv = vec2(fract(phi / PI2 + sceneCloudLongitudeOffset / PI2), 1.0 - acos(clamp(direction.y, -1.0, 1.0)) / PI);
  vec4 sampleValue = texture2D(sceneCloudMap, uv);
  float coverage;
  vec3 albedo = sceneCloudColor;
  #ifdef SCENE_CLOUD_FAR_COLOR
    if (sceneCloudMappedColor) albedo = mix(vec3(1.0), texture2D(sceneCloudColorMap, uv).rgb, sceneCloudColorStrength);
  #endif
  if (sceneCloudEncoding == 1) {
    RgbCloudSample cloud = decodeRgbCloud(sampleValue.rgb);
    coverage = cloud.coverage;
    albedo = cloud.albedo;
  } else {
    vec3 rgb = sceneCloudEncodedScalar ? sceneCloudLinearToSrgb(sampleValue.rgb) : sampleValue.rgb;
    float scalar = sceneCloudChannel == 0 ? rgb.r : sceneCloudChannel == 1 ? rgb.g : sceneCloudChannel == 2 ? rgb.b : sceneCloudChannel == 3 ? sampleValue.a : dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    coverage = clamp((scalar - sceneCloudInputRange.x) / (sceneCloudInputRange.y - sceneCloudInputRange.x), 0.0, 1.0);
    coverage = pow(sceneCloudInvert ? 1.0 - coverage : coverage, sceneCloudExponent);
  }
  vec3 sun = sceneCloudHasFrame ? normalize(mat3(sceneCloudLocalToPlanet) * sceneCloudSunDirection) : normalize(sunFallback);
  float muS = dot(direction, sun);
  vec3 tint = vec3(1.0);
  #ifdef USE_SUN_TINT
    tint = mix(vec3(1.0), sunTint(muS), uSunTintStrength);
  #endif
  vec3 sky = clamp(muS / max(sceneCloudAmbientSunRef, 1e-3), 0.0, 1.0) * tint;
  #if defined(USE_SKY_AMBIENT) && defined(USE_SUN_TINT)
    if (uSkyAmbientStrength > 0.0) sky = mix(sky, skyAmbientTint(muS), uSkyAmbientStrength);
  #endif
  vec3 direct = tint * sceneCloudLightColor;
  vec3 lighting = mix(sceneCloudAmbient * sky, direct, max(muS, 0.0));
  lighting = mix(tint * sceneCloudLightColor * smoothstep(-0.08, 0.25, muS), lighting, sceneCloudLambert);
  vec3 cloudColor = albedo * lighting * eclipseLight(direction * uBodyRadiusUnits);
  return mix(baseColor, cloudColor, coverage);
  #else
    return baseColor;
  #endif
}
`
