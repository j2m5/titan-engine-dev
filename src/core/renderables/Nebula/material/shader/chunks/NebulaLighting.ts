// Single-scattered stellar light. The caller adds intrinsic gas emission separately.
export const nebulaLightingChunk = `
  uniform float uDensityScale;
  uniform float uGasAbsorption;
  uniform float uDustStrength;
  uniform float uScatterStrength;
  uniform vec3  uStarLocal;
  uniform float uHasStar;
  uniform float uLightFalloff;
  uniform float uPhaseHG;
  uniform float uAnisotropy;
  uniform float uShadowStrength;
  uniform float uLightSteps;
  #ifdef NEB_BAKED_ONLY
    uniform float uDensityUnitRange;
  #endif

  float nebulaPhase(vec3 rd, vec3 toStar) {
    if (uPhaseHG < 0.5) return max(dot(-rd, toStar), 0.0);
    // rd points camera -> sample; toStar points sample -> star. Their dot is
    // the propagation cosine, positive for forward scattering toward the viewer.
    // 4*pi times normalized HG: g=0 gives a brightness multiplier of one.
    float cosine = clamp(dot(rd, toStar), -1.0, 1.0);
    float g = uAnisotropy;
    float denominator = 1.0 + g * g - 2.0 * g * cosine;
    return (1.0 - g * g) / (denominator * sqrt(denominator));
  }

  float nebulaLightTransmittance(vec3 p, vec3 toStar, float distanceToStar) {
    if (uShadowStrength <= 0.0 || distanceToStar <= 1e-6) return 1.0;
    if (uDensityScale * uGasAbsorption <= 0.0 && uDustStrength <= 0.0) return 1.0;
    // p is inside the density cube. Stop at the star if it is inside too,
    // otherwise at the first exit face. Explicit parallel-axis branches avoid
    // 0*infinity / NaN on a face and prevent sampling clamped texels outside it.
    float path = distanceToStar;
    if (toStar.x != 0.0) path = min(path, (sign(toStar.x) - p.x) / toStar.x);
    if (toStar.y != 0.0) path = min(path, (sign(toStar.y) - p.y) / toStar.y);
    if (toStar.z != 0.0) path = min(path, (sign(toStar.z) - p.z) / toStar.z);
    if (path <= 0.0) return 1.0;

    float dt = path / uLightSteps;
    float tau = 0.0;
    #ifdef NEB_BAKED_ONLY
      // Normalized samples cannot exceed this optical depth, including any
      // partial sum. Leave a full unit below the cutoff for rounding. Keeping
      // this loop separate removes its texture-dependent exit at every sample.
      float upperTau = (max(uDensityScale * uGasAbsorption, 0.0) + max(uDustStrength, 0.0)) * path * uShadowStrength;
      if (uDensityUnitRange > 0.5 && upperTau < 11.0) {
        for (int i = 0; i < 16; i++) {
          if (i >= int(uLightSteps)) break;
          vec2 medium = nebulaMedium(p + toStar * (float(i) + 0.5) * dt);
          float sigma = medium.r * uDensityScale * uGasAbsorption + medium.g * uDustStrength;
          tau += sigma * dt * uShadowStrength;
        }
        return exp(-tau);
      }
    #endif
    for (int i = 0; i < 16; i++) {
      if (i >= int(uLightSteps)) break;
      vec2 medium = nebulaMedium(p + toStar * (float(i) + 0.5) * dt);
      float sigma = medium.r * uDensityScale * uGasAbsorption + medium.g * uDustStrength;
      tau += sigma * dt * uShadowStrength;
      // Remaining transmission is below 0.000006; skip opaque light paths.
      if (tau >= 12.0) return 0.0;
    }
    return exp(-tau);
  }

  float nebulaStarLight(vec3 p, vec3 rd) {
    if (uHasStar < 0.5 || uScatterStrength <= 0.0) return 0.0;
    vec3 toStarVec = uStarLocal - p;
    float distanceToStar = length(toStarVec);
    vec3 toStar = toStarVec / max(distanceToStar, 1e-6);
    float scatter = uScatterStrength * nebulaPhase(rd, toStar);
    if (uLightFalloff > 0.001) {
      float q = distanceToStar / uLightFalloff;
      scatter /= 1.0 + q * q;
    }
    if (scatter <= 0.0) return 0.0;
    return scatter * nebulaLightTransmittance(p, toStar, distanceToStar);
  }
`
