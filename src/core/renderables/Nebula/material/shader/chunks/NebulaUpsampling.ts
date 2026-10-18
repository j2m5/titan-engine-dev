// Reconstruct premultiplied HDR only across matching scene depths. At a depth
// discontinuity the caller raymarches this full-resolution pixel instead.
export const nebulaUpsamplingChunk = `
  uniform sampler2D uLowResolutionMap;
  uniform vec2 uLowResolutionSize;
  uniform float uLowResolutionEnabled;

  bool nebulaMatchingDepth(float a, float b) {
    bool skyA = a >= 1.0 - 1e-6;
    bool skyB = b >= 1.0 - 1e-6;
    if (skyA != skyB) return false;
    // z * logFar is log2(1 + view depth): 0.014 is approximately a 1% change
    // in distance, independent of the camera's far plane and world scale.
    return skyA || abs(a - b) * uLogFarFactor <= 0.014;
  }

  bool nebulaLowResolution(out vec4 result) {
    if (uLowResolutionEnabled < 0.5 || uSceneDepthEnabled < 0.5) return false;
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec2 pixel = uv * uLowResolutionSize - 0.5;
    ivec2 base = ivec2(floor(pixel));
    vec2 f = fract(pixel);
    vec4 weights = vec4((1.0-f.x)*(1.0-f.y), f.x*(1.0-f.y), (1.0-f.x)*f.y, f.x*f.y);
    float depth = texture(uSceneDepth, uv).r;
    result = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      if (weights[i] <= 0.0) continue;
      ivec2 p = clamp(base + ivec2(i % 2, i / 2), ivec2(0), ivec2(uLowResolutionSize) - 1);
      // The shared target may be larger than this volume's viewport. Fetch by
      // texel, while scene depth uses that viewport's normalized coordinates.
      vec2 sourceUV = (vec2(p) + 0.5) / uLowResolutionSize;
      if (!nebulaMatchingDepth(depth, texture(uSceneDepth, sourceUV).r)) return false;
      result += texelFetch(uLowResolutionMap, p, 0) * weights[i];
    }
    return true;
  }
`
