/**
 * GLSL-чанк процедурного облика астероида (L0, фрагмент).
 *
 * Тип породы+тинт по per-instance сиду + кратеры/трещины/каверн-AO из
 * расширенного Worley (worleyCell). Домен — направление объектной позиции
 * (сфера-домен, без UV-швов) со сдвигом per-instance. Зависит от worleyCell и
 * snoise (chunk noiseFunctions) — фрагмент обязан включить <noiseFunctions>
 * перед <asteroidSurfaceFunctions>.
 */
export const asteroidSurfaceFunctions = `
  #define ASTEROID_CRATER_MAX_OCTAVES 2

  // float→float хеш для декоррелированных сидов из per-instance сида
  float hashSurface11(float x) {
    return fract(sin(x * 91.3458) * 47453.5453);
  }

  // Базовый цвет породы: пороги t1<t2 делят сид типа [0,1] на C/S/M
  vec3 rockBaseColor(float typeSeed, vec3 cCol, vec3 sCol, vec3 mCol, float t1, float t2) {
    if (typeSeed < t1) return cCol;   // углистый (тёмный)
    if (typeSeed < t2) return sCol;   // силикатный
    return mCol;                       // металлический (реже)
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

  // Композит облика. dir — нормализованная объектная позиция; instanceSeed —
  // per-instance константа. out h — высота (для нормали через экранные
  // производные), out ao — фактор затенения каверн. Возвращает albedo.
  vec3 applyAsteroidSurface(
    vec3 dir, float instanceSeed,
    vec3 cCol, vec3 sCol, vec3 mCol, float t1, float t2, float tintStrength,
    float craterFreq, float craterDensity, float craterRadius, float craterDepth, float craterOctaves,
    float crackWidth, float crackIntensity, float crackPatchiness,
    float aoStrength,
    out float h, out float ao
  ) {
    float typeSeed = instanceSeed;
    float tintSeed = hashSurface11(instanceSeed + 3.17);
    vec3 domainOffset = vec3(
      hashSurface11(instanceSeed + 1.1),
      hashSurface11(instanceSeed + 2.2),
      hashSurface11(instanceSeed + 3.3)
    ) * 40.0;

    // База: тип + внутритиповый оттенок (низкочастотный мотл + сдвиг по сиду)
    vec3 base = rockBaseColor(typeSeed, cCol, sCol, mCol, t1, t2);
    float mottle = snoise(dir * 2.0 + domainOffset);
    base *= 1.0 + tintStrength * (0.5 * mottle + 0.5 * (tintSeed - 0.5));

    // Worley по октавам: один вызов на октаву кормит кратеры и трещины
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
    float patch = 0.5 + 0.5 * snoise(dir * 3.0 + domainOffset * 1.7);
    crack *= mix(1.0, patch, crackPatchiness) * crackIntensity;
    h -= crack * 0.3;   // трещина — канавка

    float cavity = max(-h, 0.0);
    vec3 albedo = base * (1.0 - 0.5 * cavity);
    albedo = mix(albedo, albedo * 0.4, crack);

    ao = clamp(1.0 - aoStrength * cavity, 0.0, 1.0);
    return albedo;
  }
`
