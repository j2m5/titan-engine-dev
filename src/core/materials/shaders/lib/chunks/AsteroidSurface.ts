/**
 * GLSL-чанк процедурного облика астероида (L0, фрагмент).
 *
 * Единый цвет профиля + per-instance джиттер яркости/тинта + кратеры/трещины/
 * каверн-AO из расширенного Worley (worleyCell) + слой микрозерна. Домен —
 * направление объектной позиции (сфера-домен, без UV-швов) со сдвигом
 * per-instance. Зависит от worleyCell и snoise (chunk noiseFunctions) —
 * фрагмент обязан включить <noiseFunctions> перед <asteroidSurfaceFunctions>.
 */
export const asteroidSurfaceFunctions = `
  #define ASTEROID_CRATER_MAX_OCTAVES 2

  // float→float хеш для декоррелированных сидов из per-instance сида
  float hashSurface11(float x) {
    return fract(sin(x * 91.3458) * 47453.5453);
  }

  // Радиальный профиль кратера: чаша (впадина) + приподнятый вал; r=F1/радиус
  float craterProfile(float r) {
    if (r > 1.0) return 0.0;
    float bowl = (r * r - 1.0);                       // -1 центр → 0 край
    float rim  = exp(-40.0 * (r - 0.9) * (r - 0.9));  // узкий вал у r≈0.9
    // Гладкое затухание к краю (r→1): без него разрыв высоты на ободке даёт
    // яркое кольцо через экранные производные нормали во фрагменте.
    return (bowl * 0.6 + rim * 0.5) * (1.0 - smoothstep(0.9, 1.0, r));
  }

  // Возмущение нормали из градиента высоты (экранные производные), без текстур.
  // Копия three.js perturbNormalArb — чтобы не тянуть bumpFunctions/bumpMap.
  vec3 perturbNormalFromHeight(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDirection) {
    vec3 vSigmaX = dFdx(surfPos);
    vec3 vSigmaY = dFdy(surfPos);
    vec3 vN = surfNorm;
    vec3 R1 = cross(vSigmaY, vN);
    vec3 R2 = cross(vN, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surfNorm - vGrad);
  }

  // Композит облика. dir — нормализованная объектная позиция; instanceSeed —
  // per-instance константа. baseColor — цвет профиля; тонкий per-instance джиттер
  // яркости по сиду. out h — высота (для нормали), out ao — каверн-AO.
  vec3 applyAsteroidSurface(
    vec3 dir, float instanceSeed,
    vec3 baseColor, float colorJitter, float tintStrength,
    float grainStrength, float grainFreq,
    float craterFreq, float craterDensity, float craterRadius, float craterDepth, float craterOctaves,
    float crackWidth, float crackIntensity, float crackPatchiness,
    float aoStrength,
    out float h, out float ao
  ) {
    float tintSeed = hashSurface11(instanceSeed + 3.17);
    vec3 domainOffset = vec3(
      hashSurface11(instanceSeed + 1.1),
      hashSurface11(instanceSeed + 2.2),
      hashSurface11(instanceSeed + 3.3)
    ) * 40.0;

    // База профиля + тонкий per-instance джиттер яркости + внутриповерхностный мотл
    vec3 base = baseColor * (1.0 + colorJitter * (tintSeed - 0.5) * 2.0);
    float mottle = snoise(dir * 2.0 + domainOffset);
    base *= 1.0 + tintStrength * mottle * 0.5;

    // Кратеры + трещины: один worleyCell на октаву
    h = 0.0;
    float crack = 0.0;
    float amp = 1.0;
    float freq = craterFreq;
    for (int o = 0; o < ASTEROID_CRATER_MAX_OCTAVES; o++) {
      if (float(o) >= craterOctaves) break;
      vec3 toNearest;
      vec4 w = worleyCell(dir * freq + domainOffset, toNearest);
      float F1 = w.x; float F2 = w.y; float cellHash = w.z;
      float exists = step(1.0 - craterDensity, cellHash);
      float rr = craterRadius * (0.5 + 0.5 * hashSurface11(cellHash * 13.1));
      float r = F1 / rr;
      h += exists * amp * craterDepth * craterProfile(r);
      float edge = F2 - F1;
      crack += (1.0 - smoothstep(0.0, crackWidth, edge));
      amp *= 0.5;
      freq *= 2.0;
    }

    crack = clamp(crack, 0.0, 1.0);
    float patchMask = 0.5 + 0.5 * snoise(dir * 3.0 + domainOffset * 1.7);
    crack *= mix(1.0, patchMask, crackPatchiness) * crackIntensity;
    h -= crack * 0.3;   // трещина — канавка

    // Микрозерно (ВЧ, низкоамплитудное) в ту же высоту → один проход нормали
    float grain = snoise(dir * grainFreq + domainOffset) * 0.6
                + snoise(dir * grainFreq * 2.3 + domainOffset * 1.3) * 0.4;
    h += grainStrength * grain;

    float cavity = max(-h, 0.0);
    vec3 albedo = base * (1.0 - 0.5 * cavity);
    albedo = mix(albedo, albedo * 0.4, crack);

    ao = clamp(1.0 - aoStrength * cavity, 0.0, 1.0);
    return albedo;
  }
`
