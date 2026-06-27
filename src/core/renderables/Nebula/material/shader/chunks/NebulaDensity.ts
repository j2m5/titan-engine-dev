// GLSL chunk: analytic boundary + warped fbm density.
// Mirror of fields/NebulaField.ts (boundary + noiseField + sampleDensity).
// Lobes / cavities / Worley are layered in by Task 11.
export const nebulaDensityChunk = `
  uniform int   uShape;        // 0 ellipsoid, 1 disk
  uniform vec3  uInvAxis;
  uniform float uEdgeFalloff;
  uniform int   uOctaves;
  uniform float uFrequency;
  uniform float uLacunarity;
  uniform float uGain;
  uniform float uWarpStrength;
  uniform float uRidged;
  uniform float uContrast;

  float nebBoundary(vec3 p) {
    // Mirror of NebulaField.boundary. The disk's vertical falloff is steeper
    // than radial (DISK_VERTICAL_STEEPNESS = 2) so a disk reads as genuinely
    // flatter than an ellipsoid at equal axisRatios. MUST stay in sync with CPU.
    const float diskVerticalSteepness = 2.0;
    vec3 a = p * uInvAxis;
    if (uShape == 1) {
      float r = length(a.xz);
      float radial = 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, r);
      float vertical = 1.0 - smoothstep(1.0 - uEdgeFalloff * diskVerticalSteepness, 1.0, abs(a.y));
      return max(0.0, radial * vertical);
    }
    float r = length(a);
    return 1.0 - smoothstep(1.0 - uEdgeFalloff, 1.0, r);
  }

  // Low-frequency dust channel, decorrelated from the main noise by a position
  // offset (snoise has no seed). Single octave: dust lanes are broad and low-freq,
  // so extra octaves would only add per-step cost. Mirror: NebulaField.dustMask.
  float nebulaDust(vec3 p) {
    float n = snoise(p * 0.9 + vec3(55.5));
    return clamp(1.0 - abs(n), 0.0, 1.0);
  }

  // Returns density in [0,1]. Worley cavities / lobes added in Task 11.
  float nebulaDensity(vec3 p) {
    float b = nebBoundary(p);
    if (b <= 0.0) return 0.0;
    vec3 q = nebDomainWarp(p, uWarpStrength, uLacunarity, uGain) * uFrequency;
    float base = nebFbm(q, uOctaves, uLacunarity, uGain);
    float billow = abs(base);
    float ridged = 1.0 - abs(base);
    base = mix(billow, ridged, uRidged);
    float d = b * clamp(base, 0.0, 1.0);
    d = pow(clamp(d, 0.0, 1.0), uContrast);
    return clamp(d, 0.0, 1.0);
  }
`
