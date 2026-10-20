import { glslFloat } from './WaterGlint'
import { OCEAN_CREST_SHARPNESS, OCEAN_WARP_K, OCEAN_WARP_STRENGTH, OCEAN_WAVES } from './waterOceanMath'

const waves = OCEAN_WAVES.map(wave => {
  const k = wave.direction.map(v => (2 * Math.PI * v) / wave.period)
  const frequency = Math.sqrt(9.81 * Math.hypot(...k))
  return `waterOceanBand(mod(p, ${glslFloat(wave.period)}), up, time, pixelDx, pixelDy, gain, warp, warpGradient,
    vec3(${k.map(glslFloat).join(', ')}), ${glslFloat(frequency)}, ${glslFloat(wave.amplitude)},
    ${glslFloat(wave.phase)}, surface, amplitude);`
}).join('\n')

export const waterOceanFunctions = /* glsl */ `
  struct WaterOceanSurface {
    float height;
    vec3 gradient;
    float crest;
    float variance;
  };

  void waterOceanBand(vec3 p, vec3 up, float time, vec3 pixelDx, vec3 pixelDy, float gain,
      float warp, vec3 warpGradient, vec3 k, float frequency, float waveAmplitude,
      float initialPhase, inout WaterOceanSurface surface, inout float amplitude) {
    vec3 phaseGradient = k + warpGradient;
    float phaseFootprint = max(1e-6, max(abs(dot(phaseGradient, pixelDx)), abs(dot(phaseGradient, pixelDy))));
    float fundamental = waterOctaveWeight(2.0 * PI, phaseFootprint);
    float harmonic = waterOctaveWeight(PI, phaseFootprint);
    float a = waveAmplitude * gain;
    float phase = dot(p, k) - frequency * time + initialPhase + warp;
    surface.height += a * (fundamental * sin(phase) - ${glslFloat(OCEAN_CREST_SHARPNESS)} * harmonic * cos(2.0 * phase));
    surface.gradient += a * (fundamental * cos(phase) + ${glslFloat(2 * OCEAN_CREST_SHARPNESS)} * harmonic * sin(2.0 * phase)) * phaseGradient;
    float tangentK2 = max(0.0, dot(phaseGradient, phaseGradient) - pow(dot(phaseGradient, up), 2.0));
    surface.variance += a * a * tangentK2 * (0.5 * (1.0 - fundamental * fundamental)
      + ${glslFloat(2 * OCEAN_CREST_SHARPNESS ** 2)} * (1.0 - harmonic * harmonic));
    amplitude += a * fundamental;
  }

  WaterOceanSurface waterOceanSurface(vec3 p, vec3 up, float time, vec3 pixelDx, vec3 pixelDy, float strength) {
    WaterOceanSurface surface = WaterOceanSurface(0.0, vec3(0.0), 0.0, 0.0);
    float gain = clamp(strength, 0.0, 3.0);
    float amplitude = 0.0;
    vec3 warpK = vec3(${OCEAN_WARP_K.map(glslFloat).join(', ')});
    float warpPhase = dot(mod(p, 640.0), warpK) - time * 0.19;
    float warp = sin(warpPhase) * ${glslFloat(OCEAN_WARP_STRENGTH)};
    vec3 warpGradient = cos(warpPhase) * ${glslFloat(OCEAN_WARP_STRENGTH)} * warpK;
    ${waves}
    surface.gradient -= up * dot(surface.gradient, up);
    surface.crest = amplitude > 0.0 ? smoothstep(0.55, 1.05, surface.height / amplitude) * min(gain, 1.0) : 0.0;
    return surface;
  }

  // Two bounded height queries add local relief without moving the coarse
  // planetary shell. Fade the offset at the horizon where height mapping folds.
  WaterOceanSurface waterOceanRelief(vec3 p, vec3 up, vec3 toEye, float time, vec3 pixelDx, vec3 pixelDy, float strength) {
    float mu = max(dot(up, toEye), 0.0);
    vec3 tangentView = toEye - up * dot(up, toEye);
    float relief = smoothstep(0.08, 0.35, mu);
    WaterOceanSurface surface = waterOceanSurface(p, up, time, pixelDx, pixelDy, strength);
    for (int i = 0; i < 2; ++i) {
      vec3 offset = tangentView * clamp(surface.height / max(mu, 0.15), -8.0, 8.0) * relief;
      surface = waterOceanSurface(p + offset, up, time, pixelDx, pixelDy, strength);
    }
    return surface;
  }

  float waterOceanFresnel(float mu) {
    return 0.02 + 0.98 * pow(1.0 - clamp(mu, 0.0, 1.0), 5.0);
  }

  float waterOceanGlint(vec3 n, vec3 l, vec3 v, float alpha2) {
    float noL = dot(n, l);
    float noV = dot(n, v);
    if (noL <= 0.0 || noV <= 0.0) return 0.0;
    vec3 h = normalize(l + v);
    float noH = max(dot(n, h), 0.0);
    float voH = max(dot(v, h), 0.0);
    float a2 = clamp(alpha2, 0.0001, 1.0);
    float d = noH * noH * (a2 - 1.0) + 1.0;
    float distribution = a2 / (PI * d * d);
    float visibility = 0.5 / max(noL * sqrt(noV * noV * (1.0 - a2) + a2)
      + noV * sqrt(noL * noL * (1.0 - a2) + a2), 1e-8);
    return min(distribution * visibility * waterOceanFresnel(voH) * noL, 4.0);
  }
`

/** Runs after the distant material/glint and before the shared cloud overlay. */
export const waterOceanShading = /* glsl */ `
  // Differentiate the unwrapped position before the divergent near-water branch.
  // Project each wave onto both pixel axes; grazing pixels are highly elongated.
  vec3 oceanPixelDx = dFdx(posM);
  vec3 oceanPixelDy = dFdy(posM);
  float oceanBlend = 1.0 - smoothstep(8.0, 32.0, waveFootprint);
  if (oceanBlend > 0.0) {
    vec3 oceanUp = waveDirLocal;
    vec3 oceanView = -normalize(vLocalViewDir);
    vec3 oceanSun = -normalize(vLocalLightDirection);
    WaterOceanSurface ocean = waterOceanRelief(posM, oceanUp, oceanView,
      uTime * uWaterWaveSpeed, oceanPixelDx, oceanPixelDy, uWaterRippleStrength);
    // Broad reflection normals and fine sun normals have different bandwidths.
    // Reuse the already filtered ripple samples; no derivatives in this branch.
    vec3 oceanNormal = normalize(oceanUp - ocean.gradient + fineRipple * 0.12);
    vec3 oceanSpecNormal = normalize(oceanUp - ocean.gradient + fineRipple * 0.38);
    float oceanMu = max(dot(oceanNormal, oceanView), 0.0);
    float oceanF = waterOceanFresnel(oceanMu);
    vec3 oceanRay = reflect(-oceanView, oceanNormal);
    float oceanSunHeight = dot(oceanUp, oceanSun);
    float oceanDay = smoothstep(-0.08, 0.25, oceanSunHeight);
    vec3 oceanSunTint = vec3(1.0);
    #ifdef USE_SUN_TINT
      oceanSunTint = sunTintFactor;
    #endif
    vec3 oceanDirect = waterSunColor * oceanSunTint * cloudShadow * eclipse
      * smoothstep(0.0, 0.015, oceanSunHeight);
    vec3 oceanAmbient = vec3(uWaterNightFloor) + 0.12 * oceanDay * eclipse;
    #ifdef USE_SKY_AMBIENT
      oceanAmbient = vec3(uWaterNightFloor) + 0.12 * skyAmbientTint(oceanSunHeight) * eclipse;
    #endif
    vec3 oceanSky;
    #if defined(USE_WATER_SKY) && defined(USE_SUN_TINT)
      // The LUT includes sunlight colour and dusk, but no dynamic occluders.
      oceanSky = waterSkyRadiance(oceanUp, oceanRay, oceanSun, eclipse);
    #else
      float skyZenith = clamp(dot(oceanUp, oceanRay), 0.0, 1.0);
      oceanSky = mix(uWaterFresnelTint, uWaterFresnelTint * ZENITH_DARKEN, sqrt(skyZenith));
      oceanSky *= mix(vec3(uWaterNightFloor), oceanSunTint, oceanDay * eclipse);
    #endif
    float oceanDiffuse = max(dot(oceanNormal, oceanSun), 0.0);
    vec3 oceanScatter = baseColor * (oceanAmbient + oceanDirect * (0.25 + 0.65 * oceanDiffuse));
    // Thin, sunlit crests transmit more blue-green light towards the observer.
    float backlight = pow(max(dot(oceanView, -oceanSun), 0.0), 4.0) * ocean.crest;
    oceanScatter += uWaterShallowColor * oceanDirect * backlight * 0.35;

    float oceanAlpha2 = clamp(uWaterRoughness * uWaterRoughness + ocean.variance
      + WATER_TRIPLANAR_SLOPE_GAIN2 * rippleVariance * (0.38 * 0.38), WATER_MIN_ALPHA2, 1.0);
    vec3 oceanHighlight = oceanDirect * waterOceanGlint(oceanSpecNormal, oceanSun, oceanView, oceanAlpha2)
      * uWaterGlintGain;
    // Compose reflection plus the absorbing layer in premultiplied space.
    // At depth zero reflection remains present (F0=0.02), without opaque water.
    float oceanAlpha = oceanF + (1.0 - oceanF) * depthAlpha;
    vec3 oceanPremul = (1.0 - oceanF) * oceanScatter * depthAlpha + oceanF * oceanSky + oceanHighlight;

    float crestFoam = smoothstep(0.82, 1.0, ocean.crest)
      * smoothstep(0.06, 0.13, length(fineRipple)) * 0.28 * uFoamStrength * waterOctaveWeight(4.0, waveFootprint);
    float oceanFoam = clamp(foam + crestFoam * (1.0 - foam), 0.0, 1.0);
    vec3 oceanFoamLit = uFoamColor * (oceanAmbient + oceanDirect * (0.3 + 0.7 * max(oceanSunHeight, 0.0)));
    oceanPremul = mix(oceanPremul, oceanFoamLit, oceanFoam);
    oceanAlpha = mix(oceanAlpha, 1.0, oceanFoam);
    vec3 blendedPremul = mix(color * alpha, oceanPremul, oceanBlend);
    alpha = mix(alpha, oceanAlpha, oceanBlend);
    color = blendedPremul / max(alpha, 1e-4);
  }
`
