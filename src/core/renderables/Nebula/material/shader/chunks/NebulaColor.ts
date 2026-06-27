// GLSL chunk: multichromatic self-emissive color + secondary ionization channel
// + cheap white directional scatter + dust absorption.
// Lighting is WHITE only (no star color) by design: uAmbient is the self-emission
// baseline (default 1.0 -> visible without a star); the star adds an additive
// forward-scatter highlight for spectacle, never darkens the emission.
export const nebulaColorChunk = `
  uniform vec3  uPalette0; uniform vec3 uPalette1; uniform vec3 uPalette2; uniform vec3 uPalette3;
  uniform vec4  uPaletteT;
  uniform vec3  uSecondaryColor;
  uniform float uSecondaryThreshold;
  uniform vec3  uDustColor;
  uniform float uDustStrength;
  uniform float uDustThreshold;
  uniform float uScatterStrength;
  uniform float uAmbient;
  uniform vec3  uStarLocal;
  uniform float uHasStar;

  vec3 paletteLookup(float t) {
    vec3 c = uPalette0;
    c = mix(c, uPalette1, smoothstep(uPaletteT.x, uPaletteT.y, t));
    c = mix(c, uPalette2, smoothstep(uPaletteT.y, uPaletteT.z, t));
    c = mix(c, uPalette3, smoothstep(uPaletteT.z, uPaletteT.w, t));
    return c;
  }

  vec3 nebulaColor(float density, float dust, vec3 p, vec3 rd) {
    vec3 base = paletteLookup(density);
    // secondary ionization channel: tint dense regions toward the accent color
    float sec = smoothstep(uSecondaryThreshold, 1.0, density);
    base = mix(base, uSecondaryColor, sec * 0.6);
    // self-emission baseline (uAmbient) + optional white directional forward scatter
    float light = uAmbient;
    if (uHasStar > 0.5) {
      vec3 toStar = normalize(uStarLocal - p);
      light += uScatterStrength * max(dot(-rd, toStar), 0.0);
    }
    base *= light;
    // dust absorption: darken high-dust regions toward the dust color
    float dustAmt = uDustStrength * smoothstep(uDustThreshold, 1.0, dust);
    base = mix(base, uDustColor, dustAmt);
    return base;
  }
`
