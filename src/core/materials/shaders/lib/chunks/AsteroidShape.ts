/**
 * GLSL-чанк процедурной деформации силуэта астероида (L0).
 *
 * Смещает вершины икосаэдра вдоль нормали на fbm производного симплекс-шума,
 * домен которого сдвинут per-instance сидом → уникальный неровный контур у
 * каждого камня. Нормаль пересчитывается из аналитического градиента шума.
 *
 * Зависит от snoiseGrad (chunk noiseFunctions) — вершинный шейдер обязан
 * включить <noiseFunctions> перед <asteroidShapeFunctions>.
 * Юниформы uShapeAmp/uShapeFreq объявляет включающий шейдер (см. L0-шаблон).
 */
export const asteroidShapeFunctions = `
  #define ASTEROID_SHAPE_OCTAVES 3

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

  // Деформация вершины икосаэдра в объектном пространстве.
  // pos/normal — исходные; seed — стабильный сид камня.
  void deformAsteroid(vec3 pos, vec3 normal, float seed, out vec3 displacedPos, out vec3 newNormal) {
    float R = length(pos);
    vec3 dir = pos / max(R, 1e-6);
    vec3 domain = dir * uShapeFreq + vec3(seed * 17.13, seed * 5.71, seed * 9.37);

    vec4 nv = fbmGrad(domain);
    float f = nv.x;
    vec3 grad = nv.yzw;

    displacedPos = pos + normal * (f * uShapeAmp * R);

    // Возмущение нормали: вычитаем тангенциальную составляющую градиента.
    vec3 gTangent = grad - dot(grad, normal) * normal;
    newNormal = normalize(normal - uShapeAmp * gTangent);
  }
`
