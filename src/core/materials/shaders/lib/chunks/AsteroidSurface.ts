/**
 * GLSL-чанк МАКРО-облика астероида (L0, фрагмент): единый цвет профиля +
 * per-instance джиттер/мотл/maria + кратеры/каверн-AO из расширенного Worley
 * (worleyCell). Домен — направление объектной позиции (сфера-домен, без
 * UV-швов) со сдвигом per-instance. Микродеталь (высокочастотное зерно/
 * трещины) теперь даёт фотограмметрический PBR-микрослой (см. чанк
 * TriplanarDetail) — этот чанк отвечает только за крупную форму облика.
 *
 * Нормаль возмущается АНАЛИТИЧЕСКИМ градиентом кратеров (∇F1=toNearest ·
 * производную профиля craterProfileD), а НЕ конечными разностями dFdx/dFdy —
 * иначе ВЧ-деталь даёт попиксельную статику. Зависит от worleyCell, snoise
 * (chunk noiseFunctions) — фрагмент обязан включить <noiseFunctions> перед
 * <asteroidSurfaceFunctions>.
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
  // Нормаль возмущается АНАЛИТИЧЕСКИМ градиентом кратеров → без dFdx-статики.
  // out perturbedNormal — объектная нормаль (фрагмент переводит во view),
  // out ao — каверн-AO. Возвращает albedo.
  vec3 applyAsteroidSurface(
    vec3 dir, vec3 objNormal, float instanceSeed,
    vec3 baseColor, float colorJitter, float tintStrength, float mariaStrength,
    float normalScale,
    float craterFreq, float craterDensity, float craterRadius, float craterDepth, float craterOctaves,
    float aoStrength,
    out vec3 perturbedNormal, out float ao, out vec3 baseAlbedo
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

    // Крупномасштабное альбедо (maria/highlands): НЧ-маска делит поверхность на
    // тёмные базальтовые равнины (maria) и светлые возвышенности → макро-
    // композиция, поверхность перестаёт читаться как равномерный шум. Частоты
    // низкие, поэтому маска стабильна на расстоянии (не мельтешит, в отличие от
    // кратеров/трещин). Модулирует ТОЛЬКО базовый цвет — деталь ложится поверх.
    float mariaField = 0.7 * snoise(dir * 1.2 + domainOffset * 0.7)
                     + 0.3 * snoise(dir * 2.6 + domainOffset * 1.9);
    float maria = smoothstep(-0.15, 0.35, mariaField);   // мягкие «берега» регионов
    base *= 1.0 - mariaStrength * maria;                 // равнины темнее

    // Кратеры: высота craterH (cavity/AO) + аналитический градиент gradH (нормаль).
    float craterH = 0.0;
    vec3 gradH = vec3(0.0);   // ∇h в dir-пространстве (для нормали)
    float amp = 1.0;
    float freq = craterFreq;
    for (int o = 0; o < ASTEROID_CRATER_MAX_OCTAVES; o++) {
      if (float(o) >= craterOctaves) break;
      vec3 toNearest;
      // Domain warp: искривляем входной домен Вороного НЧ-шумом → решётка «плывёт»,
      // кратеры расположены неровно, а не сидят на регулярной сетке.
      // ВАЖНО про частоту: смещение ячеек ∝ амплитуде, а искажение ФОРМЫ кратера
      // ∝ амплитуде·частоте·радиусе (насколько warp меняется поперёк кратера).
      // Поэтому частота НИЗКАЯ (×0.25, длина волны ~4 ед. ≫ радиуса кратера):
      // warp почти постоянен в пределах кратера → круги остаются кругами, но
      // расположение по поверхности нерегулярное. Амплитуда < размера ячейки (~1).
      vec3 wp = dir * freq + domainOffset;
      vec3 warp = vec3(
        snoise(wp * 0.25 + 11.1),
        snoise(wp * 0.25 + 27.3),
        snoise(wp * 0.25 + 41.7)
      );
      vec4 w = worleyCell(wp + 0.35 * warp, toNearest);
      float F1 = w.x; float cellHash = w.z;
      // Мягкое существование кратера: плавная полоса по хешу ячейки вместо
      // бинарного step → нет резкого «пэтчворка» решётки Вороного, а ячейки у
      // порога дают мелкие/неглубокие кратеры (естественный разброс размеров).
      float exists = smoothstep(1.0 - craterDensity - 0.08, 1.0 - craterDensity + 0.08, cellHash);
      // Возраст кратера (декоррелированный хеш ячейки): свежий (0) — глубокий,
      // старый (1) — мелкий. Дно свежих темнее (глубже → больше cavity), у
      // старых сглажено.
      float age = hashSurface11(cellHash * 7.3);
      float depth = craterDepth * mix(1.0, 0.45, age);
      float rr = craterRadius * (0.5 + 0.5 * hashSurface11(cellHash * 13.1));
      float r = F1 / rr;
      craterH += exists * amp * depth * craterProfile(r);
      // Направление наклона кратера = toNearest (∇F1). Множитель частоты freq/rr
      // НЕ включаем: он даёт физически-верный, но чрезмерный наклон, «смывающий»
      // общее затенение. Силу наклона задаёт depth·craterProfileD + normalScale.
      gradH += exists * amp * depth * craterProfileD(r) * toNearest;
      amp *= 0.5;
      freq *= 2.0;
    }

    // Возмущение нормали: тангенциальная составляющая градиента (как в форме).
    vec3 gTangent = gradH - dot(gradH, objNormal) * objNormal;
    // Мягкий кламп |gTangent| < 1: геом. нормаль всегда доминирует, общее
    // затенение камня не «смывается» даже на сильных градиентах (ободки кратеров).
    gTangent /= 1.0 + length(gTangent);
    perturbedNormal = normalize(objNormal - normalScale * gTangent);

    // Базовое альбедо (maria/мотл/джиттер — НЧ, стабильно на расстоянии) отдаём
    // наружу: фрагмент сводит к нему ВЧ-деталь кратеров с дистанцией (B0).
    baseAlbedo = base;

    // Кратерное альбедо-затемнение убрано (задача 5): дно кратеров теперь
    // читается только через AO + PBR-микрослой (см. чанк TriplanarDetail).
    vec3 albedo = base;

    float cavity = max(-craterH, 0.0);
    ao = clamp(1.0 - aoStrength * cavity, 0.0, 1.0);
    return albedo;
  }
`
