/**
 * GLSL-чанк процедурного облика астероида (L0, фрагмент).
 *
 * Единый цвет профиля + per-instance джиттер + кратеры/трещины/каверн-AO из
 * расширенного Worley (worleyCell) + микрозерно. Домен — направление объектной
 * позиции (сфера-домен, без UV-швов) со сдвигом per-instance.
 *
 * Нормаль возмущается АНАЛИТИЧЕСКИМ градиентом (зерно через snoiseGrad, кратеры
 * через ∇F1=toNearest · производную профиля craterProfileD), а НЕ конечными
 * разностями dFdx/dFdy — иначе ВЧ-деталь даёт попиксельную статику. Трещины —
 * только в альбедо (в градиент нормали не входят). Зависит от worleyCell,
 * snoise, snoiseGrad (chunk noiseFunctions) — фрагмент обязан включить
 * <noiseFunctions> перед <asteroidSurfaceFunctions>.
 */
export const asteroidSurfaceFunctions = `
  #define ASTEROID_CRATER_MAX_OCTAVES 2

  // float→float хеш для декоррелированных сидов из per-instance сида
  float hashSurface11(float x) {
    return fract(sin(x * 91.3458) * 47453.5453);
  }

  // Радиальный профиль кратера: чаша (впадина) + приподнятый вал; r=F1/радиус.
  // Гладкое затухание к краю (r→1), чтобы не было разрыва высоты на ободке.
  float craterProfile(float r) {
    if (r > 1.0) return 0.0;
    float bowl = (r * r - 1.0);
    float rim  = exp(-40.0 * (r - 0.9) * (r - 0.9));
    return (bowl * 0.6 + rim * 0.5) * (1.0 - smoothstep(0.9, 1.0, r));
  }

  // Аналитическая производная профиля кратера dP/dr — для нормали без dFdx.
  float craterProfileD(float r) {
    if (r > 1.0) return 0.0;
    float rim = exp(-40.0 * (r - 0.9) * (r - 0.9));
    float P   = (r * r - 1.0) * 0.6 + rim * 0.5;               // профиль без окна
    float Pd  = 1.2 * r + 0.5 * rim * (-80.0 * (r - 0.9));     // dP/dr
    float t   = clamp((r - 0.9) / 0.1, 0.0, 1.0);
    float win  = 1.0 - t * t * (3.0 - 2.0 * t);                // 1 - smoothstep(0.9,1,r)
    float winD = -6.0 * t * (1.0 - t) / 0.1;                   // d/dr окна (0 вне 0.9..1)
    return Pd * win + P * winD;
  }

  // Композит облика. dir — нормализованная объектная позиция; objNormal — геом.
  // нормаль в объектном пространстве; instanceSeed — per-instance константа.
  // Нормаль возмущается АНАЛИТИЧЕСКИМ градиентом (зерно + кратеры) → без dFdx-
  // статики; трещины — только альбедо. out perturbedNormal — объектная нормаль
  // (фрагмент переводит во view), out ao — каверн-AO. Возвращает albedo.
  vec3 applyAsteroidSurface(
    vec3 dir, vec3 objNormal, float instanceSeed,
    vec3 baseColor, float colorJitter, float tintStrength,
    float grainStrength, float grainFreq, float normalScale,
    float craterFreq, float craterDensity, float craterRadius, float craterDepth, float craterOctaves,
    float crackWidth, float crackIntensity, float crackPatchiness,
    float aoStrength,
    out vec3 perturbedNormal, out float ao
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

    // Кратеры: высота craterH (cavity/AO/альбедо) + аналитический градиент gradH.
    // Трещины: только альбедо (crack) — в gradH НЕ входят.
    float craterH = 0.0;
    vec3 gradH = vec3(0.0);   // ∇h в dir-пространстве (для нормали)
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
      craterH += exists * amp * craterDepth * craterProfile(r);
      // Направление наклона кратера = toNearest (∇F1). Множитель частоты freq/rr
      // НЕ включаем: он даёт физически-верный, но чрезмерный наклон, «смывающий»
      // общее затенение. Силу наклона задаёт craterDepth·craterProfileD + normalScale.
      gradH += exists * amp * craterDepth * craterProfileD(r) * toNearest;
      float edge = F2 - F1;
      crack += (1.0 - smoothstep(0.0, crackWidth, edge));
      amp *= 0.5;
      freq *= 2.0;
    }

    // Зерно: аналитический градиент (snoiseGrad → vec4(value, ∇)). Частоту
    // держим ТОЛЬКО в домене (dir·grainFreq — задаёт мелкость рисунка), но НЕ в
    // силе наклона (иначе зерно перекручивает нормаль). Сила = grainStrength.
    vec4 g1 = snoiseGrad(dir * grainFreq + domainOffset);
    vec4 g2 = snoiseGrad(dir * grainFreq * 2.3 + domainOffset * 1.3);
    gradH += grainStrength * (0.6 * g1.yzw + 0.4 * g2.yzw);

    // Возмущение нормали: тангенциальная составляющая градиента (как в форме).
    vec3 gTangent = gradH - dot(gradH, objNormal) * objNormal;
    // Мягкий кламп |gTangent| < 1: геом. нормаль всегда доминирует, общее
    // затенение камня не «смывается» даже на сильных градиентах (ободки кратеров).
    gTangent /= 1.0 + length(gTangent);
    perturbedNormal = normalize(objNormal - normalScale * gTangent);

    // Трещины (только альбедо): тёмные линии вдоль рёбер Вороного, с патчевостью
    crack = clamp(crack, 0.0, 1.0);
    float patchMask = 0.5 + 0.5 * snoise(dir * 3.0 + domainOffset * 1.7);
    crack *= mix(1.0, patchMask, crackPatchiness) * crackIntensity;

    // Альбедо: затемнение дна кратеров + тёмные трещины
    float cavity = max(-craterH, 0.0);
    vec3 albedo = base * (1.0 - 0.5 * cavity);
    albedo = mix(albedo, albedo * 0.4, crack);

    ao = clamp(1.0 - aoStrength * cavity, 0.0, 1.0);
    return albedo;
  }
`
