// GLSL chunk: fbm + domain warp for the nebula raymarch shader.
// Built on snoise(vec3) provided by <noiseFunctions>.
// CPU mirror lives in fields/valueNoise.ts (fbm3) and NebulaField.noiseField.
export const nebulaNoiseChunk = `
  float nebFbm(vec3 p, int octaves, float lacunarity, float gain) {
    float sum = 0.0; float amp = 0.5; float freq = 1.0; float norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      sum += amp * snoise(p * freq);
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return norm > 0.0 ? (sum / norm) : 0.0;
  }

  vec3 nebDomainWarp(vec3 p, float strength, float lacunarity, float gain) {
    // 2 octaves (not 3): the warp is a low-frequency positional distortion, so
    // the third octave is visually negligible but costs 3 extra snoise/step.
    // Mirror: NebulaField.noiseField warp uses 2 octaves too.
    float wx = nebFbm(p + vec3(11.3, 0.0, 0.0), 2, lacunarity, gain);
    float wy = nebFbm(p + vec3(0.0, 7.7, 0.0), 2, lacunarity, gain);
    float wz = nebFbm(p + vec3(0.0, 0.0, 19.1), 2, lacunarity, gain);
    return p + strength * vec3(wx, wy, wz);
  }
`
