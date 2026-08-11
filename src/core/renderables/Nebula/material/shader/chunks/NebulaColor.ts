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
  uniform float uRadialMix;
  uniform vec3  uInnerColor;
  uniform vec3  uOuterColor;

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

    // Radial ionisation tint. Density answers "how thick"; in a planetary nebula
    // the colour answers a different question — "how ionised" — and that one is
    // radial: O III near the star, H-alpha further out, [N II] at the very rim.
    // Standing in for it with density only holds while the two are correlated,
    // which a knotted shell breaks.
    //
    // Gated on uRadialMix so the default (0) leaves every existing nebula byte
    // for byte as it was — this chunk is shared by all of them.
    //
    // p is proxy-local in [-1,1]^3, so length(p) reaches 1 on an axis and sqrt(3)
    // in a corner; the clamp flattens the corners. Good enough for a hue ramp —
    // it would NOT be for a hard boundary, which is why nebBoundary scales by
    // uInvAxis instead.
    if (uRadialMix > 0.001) {
      float radial = clamp(length(p), 0.0, 1.0);
      base = mix(base, mix(uInnerColor, uOuterColor, radial), uRadialMix);
    }
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
