import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** Scene-reference sun lighting only; physical lab/giant and shadow-map shaders stay upstream. */
export function adaptSceneCloudSunShadow(shader: string): string {
  shader = replaceExactlyOnce(
    shader,
    'float opticalDepth = marchOpticalDepth(',
    'float opticalDepth = sceneCloudMarchSunOpticalDepth(',
    'scene cloud',
    'sun optical-depth call'
  )
  return replaceExactlyOnce(
    shader,
    'vec4 marchClouds(',
    `
float sceneCloudMarchSunOpticalDepth(
  const vec3 rayOrigin,
  const vec3 rayDirection,
  const int maxIterationCount,
  const float mipLevel,
  const float jitter,
  out float rayDistance
) {
  rayDistance = 0.0;
  // Keep the existing distance LOD, including its zero-sample far field, within the quality budget.
  int iterationCount = min(maxIterationCount, int(max(0.0,
    remap(mipLevel, 0.0, 1.0, float(maxIterationCount + 1), 1.0) - jitter)));
  if (iterationCount <= 0) return 0.0;

  // Cover Earth's 1.2 km erosion scale with the same 1/2/4 samples at every quality.
  // maxHeight also covers layers that do not cast a shadow map.
  float distanceToTop = raySphereSecondIntersection(
    rayOrigin, rayDirection, vec3(0.0), bottomRadius + maxHeight);
  float marchLength = min(1200.0, max(0.0, distanceToTop));
  float stepSize = marchLength / (exp2(float(iterationCount)) - 1.0);
  float opticalDepth = 0.0;
  for (int i = 0; i < iterationCount; ++i) {
    // Midpoint quadrature keeps smooth extinction stable as primary-ray jitter changes.
    // Geometric intervals concentrate samples toward the current cloud point.
    vec3 position = (rayDistance + stepSize * 0.5) * rayDirection + rayOrigin;
    vec2 uv = getGlobeUv(position);
    float height = length(position) - bottomRadius;
    WeatherSample weather = sampleWeather(uv, height, mipLevel);
    MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter);
    opticalDepth += media.extinction * stepSize;
    rayDistance += stepSize;
    stepSize *= 2.0;
  }
  // The BSM tail begins at the end of the integrated intervals, not the last jittered sample.
  rayDistance = marchLength;
  return opticalDepth;
}
vec4 marchClouds(`,
    'scene cloud',
    'sun optical-depth function'
  )
}
