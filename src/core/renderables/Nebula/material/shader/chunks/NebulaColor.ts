import { nebulaLightingChunk } from './NebulaLighting'

// GLSL chunk: multichromatic self-emissive color + secondary ionization channel
// + stellar scattering. Dust has no self-emission.
// uAmbient is the self-emission baseline (default 1.0 -> visible without a star);
// the star adds scattered light, never darkens intrinsic emission.
// Scatter is WHITE by default: it scales the palette colour. With uLightTint the
// scatter term takes the star's hue instead; the ambient term is never tinted.
export const nebulaColorChunk = `
  ${nebulaLightingChunk}
  uniform vec3  uPalette0; uniform vec3 uPalette1; uniform vec3 uPalette2; uniform vec3 uPalette3;
  uniform vec4  uPaletteT;
  uniform vec3  uSecondaryColor;
  uniform float uSecondaryThreshold;
  uniform vec3  uDustColor;
  uniform float uAmbient;
  uniform vec3  uLightColor;
  uniform float uLightTint;
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

  vec3 nebulaDustColor(float scatter) {
    // Dust only reflects the supplied star; ambient and gas emissivity do not
    // illuminate it. Its colour is a reflectance, not an emissive source.
    vec3 illumination = uLightTint > 0.5 ? uLightColor : vec3(1.0);
    return uDustColor * illumination * scatter;
  }

  vec3 nebulaGasColor(float density, vec3 p, float scatter) {
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
    // self-emission baseline (uAmbient) + optional directional forward scatter
    float light = uAmbient;
    vec3 tinted = vec3(0.0);
    // A coloured light replaces the scatter hue; ambient keeps the gas palette.
    if (uLightTint > 0.5) {
      tinted = uLightColor * dot(base, vec3(0.2126, 0.7152, 0.0722)) * scatter;
    } else {
      light += scatter;
    }
    return base * light + tinted;
  }
`
