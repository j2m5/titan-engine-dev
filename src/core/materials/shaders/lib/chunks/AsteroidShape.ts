/**
 * GLSL-чанк ОСТАТОЧНОЙ деформации вершины астероида (L0).
 *
 * Форму (силуэт, звёздность осколка) несёт запечённый архетип из
 * ArchetypeShape/ArchetypeGeometry (Task 1–2 плана «генератор архетипов 2a») —
 * этот чанк её НЕ формирует. Он лишь добавляет лёгкую пер-инстансную рябь
 * малой амплитудой вдоль направления от центра (домен сдвинут per-instance
 * сидом), декоррелируя визуальные повторы у K одинаковых запечённых мешей.
 * Нормаль, приходящая аргументом, — уже осмысленная запечённая нормаль
 * осколка (раньше игнорировалась как нормаль сфероида); чанк возмущает её
 * тангенциально с мягким клампом, не давая ряби «переворачивать» освещение.
 *
 * Зависит от snoiseGrad (chunk noiseFunctions) — вершинный шейдер обязан
 * включить <noiseFunctions> перед <asteroidShapeFunctions>.
 * Юниформ uShapeFreq объявляет включающий шейдер (см. L0-шаблон); амплитуда
 * приходит аргументом amp — включающий шейдер задаёт её per-instance.
 */
export const asteroidShapeFunctions = `
  #define ASTEROID_SHAPE_OCTAVES 2

  // Хеш vec3 → float (Dave Hoskins). Стабильный сид формы из позиции инстанса.
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  // fbm производного шума: vec4(value, gradient). Градиент домена учитывает
  // частоту октавы (цепное правило d/dp snoiseGrad(p·freq)).
  vec4 fbmGrad(vec3 p) {
    vec4 sum = vec4(0.0);
    float amp = 0.5;
    float freq = 1.0;
    for (int o = 0; o < ASTEROID_SHAPE_OCTAVES; o++) {
      vec4 nv = snoiseGrad(p * freq);
      sum.x += amp * nv.x;
      sum.yzw += amp * freq * nv.yzw;
      amp *= 0.5;
      freq *= 2.0;
    }
    return sum;
  }

  // Остаточная деформация: НЕ формообразование (силуэт несёт запечённый
  // архетип), а лёгкая пер-инстансная рябь — декоррелирует повторы K мешей.
  // Смещение вдоль направления (сохраняет звёздность запечённой формы),
  // нормаль — тангенциальное возмущение ЗАПЕЧЁННОЙ нормали с мягким клампом.
  void deformAsteroid(vec3 pos, vec3 normal, float seed, float amp, out vec3 displacedPos, out vec3 newNormal) {
    float R = length(pos);
    vec3 dir = pos / max(R, 1e-6);

    vec3 domain = dir * uShapeFreq + vec3(seed * 17.13, seed * 5.71, seed * 9.37);
    vec4 nv = fbmGrad(domain);

    displacedPos = dir * (R * (1.0 + amp * nv.x));

    vec3 gdisp = amp * nv.yzw;
    vec3 gTangent = gdisp - dot(gdisp, normal) * normal;
    gTangent /= 1.0 + length(gTangent);
    newNormal = normalize(normal - gTangent);
  }
`
