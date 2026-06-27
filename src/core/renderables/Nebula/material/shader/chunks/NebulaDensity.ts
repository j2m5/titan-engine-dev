// GLSL chunk: analytic boundary + warped fbm density + lobes/cavities/Worley.
// Mirror of fields/NebulaField.ts (boundary + noiseField + lobes + cavities).
// Worley cell-wall carving is GPU-only (needs cellular3d from <noiseFunctions>);
// the CPU mirror covers lobe placement + analytic cavities, not Worley.
export const nebulaDensityChunk = `
  #define NEB_MAX_LOBES 8  // nebula-program-local define; not the shared Noise.ts

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

  uniform int   uLobeCount;
  uniform vec4  uLobeData[NEB_MAX_LOBES];   // xyz center (local), w radius
  uniform float uLobeWeight[NEB_MAX_LOBES];
  uniform int   uCavityCount;
  uniform vec4  uCavityData[NEB_MAX_LOBES]; // xyz center (local), w radius
  uniform float uCavityStrength[NEB_MAX_LOBES];
  uniform float uWorleyStrength;            // 0..1 cell-wall filament carving

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

  // Sum of Gaussian lobes (mirror of NebulaField.lobeContribution): field-level
  // composition of many sub-clouds inside one raymarch pass (no Group of meshes).
  float nebLobes(vec3 p) {
    float extra = 0.0;
    for (int i = 0; i < NEB_MAX_LOBES; i++) {
      if (i >= uLobeCount) break;
      vec3 d = p - uLobeData[i].xyz;
      float r2 = max(1e-4, uLobeData[i].w * uLobeData[i].w);
      extra += uLobeWeight[i] * exp(-dot(d, d) / r2);
    }
    return extra;
  }

  // Analytic cavity carving (mirror of NebulaField.cavityCarve) + GPU-only Worley
  // cell walls for filament structure. cellular3d is heavy (3x3x3 search), so it is
  // gated on uWorleyStrength; set noise.worleyStrength to 0 to reclaim that per-step
  // cost (it will become free once the static field is baked to a 3D texture).
  float nebCavities(vec3 p) {
    float carve = 1.0;
    for (int i = 0; i < NEB_MAX_LOBES; i++) {
      if (i >= uCavityCount) break;
      float d = length(p - uCavityData[i].xyz);
      float inside = 1.0 - clamp(d / max(1e-4, uCavityData[i].w), 0.0, 1.0);
      carve *= 1.0 - uCavityStrength[i] * inside;
    }
    if (uWorleyStrength > 0.001) {
      vec2 f = cellular3d(p * 1.7);
      float walls = mix(1.0, smoothstep(0.0, 0.4, f.y - f.x), uWorleyStrength);
      carve *= walls;
    }
    return max(0.0, carve);
  }

  // Returns density in [0,1]. Mirrors NebulaField.sampleDensity:
  // pow(clamp(boundary * (noise + lobes)) * cavities, contrast), + GPU Worley.
  float nebulaDensity(vec3 p) {
    float b = nebBoundary(p);
    if (b <= 0.0) return 0.0;
    vec3 q = nebDomainWarp(p, uWarpStrength, uLacunarity, uGain) * uFrequency;
    float base = nebFbm(q, uOctaves, uLacunarity, uGain);
    float billow = abs(base);
    float ridged = 1.0 - abs(base);
    base = mix(billow, ridged, uRidged);
    float d = b * (clamp(base, 0.0, 1.0) + nebLobes(p));
    d *= nebCavities(p);
    d = pow(clamp(d, 0.0, 1.0), uContrast);
    return clamp(d, 0.0, 1.0);
  }
`
