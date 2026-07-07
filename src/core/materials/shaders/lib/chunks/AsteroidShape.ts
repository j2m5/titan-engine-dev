/**
 * GLSL-чанк процедурной деформации силуэта астероида (L0).
 *
 * Смещает вершины икосаэдра вдоль нормали на fbm производного симплекс-шума,
 * домен которого сдвинут per-instance сидом → уникальный неровный контур у
 * каждого камня. Нормаль пересчитывается из аналитического градиента шума.
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

  // Деформация вершины икосаэдра в объектном пространстве.
  //
  // Форму несёт ТРЁХОСНЫЙ ЭЛЛИПСОИД (макро-силуэт: вытянутость/сплюснутость) —
  // он гладкий по построению, не даёт торчащих вершин «звезды». Поверх —
  // низкочастотный (2 октавы) шум как мягкие лямпы; вся ВЧ-деталь живёт во
  // фрагментном возмущении нормали (см. AsteroidSurface), а НЕ в геометрии.
  //
  // pos/normal — исходные (normal сфероида ≈ dir, не используется); seed —
  // стабильный сид камня; amp — амплитуда лямпов (per-instance из диапазона).
  void deformAsteroid(vec3 pos, vec3 normal, float seed, float amp, out vec3 displacedPos, out vec3 newNormal) {
    float R = length(pos);
    vec3 dir = pos / max(R, 1e-6);

    // Оси эллипсоида из декоррелированных хешей сида → диапазон [0.7, 1.4]
    // (отношение осей до ~2:1, как у реальных тел). Нормировка на среднее
    // геометрическое (∛(x·y·z) = 1) сохраняет объём → общий масштаб и
    // распределение minScale/maxScale не смещаются.
    vec3 axes = 0.7 + 0.7 * vec3(
      hash13(vec3(seed, 1.0, 2.0)),
      hash13(vec3(seed, 3.0, 4.0)),
      hash13(vec3(seed, 5.0, 6.0))
    );
    axes /= pow(axes.x * axes.y * axes.z, 1.0 / 3.0);

    // Точка на эллипсоиде и его АНАЛИТИЧЕСКАЯ нормаль (∝ dir / axes²).
    vec3 ePos = dir * axes * R;
    vec3 eNormal = normalize(dir / (axes * axes));

    // НЧ-шум силуэта поверх эллипсоида (домен — исходное направление).
    // Единое поле смещения disp (в долях R) + его градиент gdisp в dir-домене:
    // шум масштабируем на amp, крупные бассейны (ниже) имеют собственную глубину.
    vec3 domain = dir * uShapeFreq + vec3(seed * 17.13, seed * 5.71, seed * 9.37);
    vec4 nv = fbmGrad(domain);
    float disp = amp * nv.x;
    vec3 gdisp = amp * nv.yzw;

    // A3: 1–2 крупных ударных бассейна как ВОГНУТОСТИ геометрии. Гладкая чаша
    // вокруг случайного направления c (глубина/радиус per-instance). Влияет и на
    // позицию (вмятина), и на нормаль (аналитический градиент чаши) → стенки
    // затеняются корректно, как настоящий рельеф, а не только текстурой.
    float basinH = 0.0;
    vec3 basinGrad = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float present = step(0.4, hash13(vec3(seed, fi, 7.0)));
      vec3 c = normalize(vec3(
        hash13(vec3(seed, fi, 8.0)) - 0.5,
        hash13(vec3(seed, fi, 9.0)) - 0.5,
        hash13(vec3(seed, fi, 10.0)) - 0.5
      ));
      float rad = mix(0.15, 0.35, hash13(vec3(seed, fi, 11.0)));   // угловой радиус (через 1-cos)
      float depth = mix(0.08, 0.18, hash13(vec3(seed, fi, 12.0))); // глубина в долях R
      float u = clamp((1.0 - dot(dir, c)) / rad, 0.0, 1.0);        // 0 центр → 1 край
      float w = 1.0 - u * u * (3.0 - 2.0 * u);                     // гладкое окно чаши
      float dssdu = 6.0 * u * (1.0 - u);                          // d smoothstep(u)
      basinH -= present * depth * w;                              // впадина
      // d(basinH)/ddir = -present·depth · dw/ddir, dw/ddir = (dssdu/rad)·c
      basinGrad -= (present * depth * dssdu / rad) * c;
    }
    disp += basinH;
    gdisp += basinGrad;

    displacedPos = ePos + eNormal * (disp * R);

    // Возмущение нормали относительно эллипсоида: вычитаем тангенциальную
    // составляющую суммарного градиента (шум + бассейны; amp уже внутри gdisp).
    vec3 gTangent = gdisp - dot(gdisp, eNormal) * eNormal;
    newNormal = normalize(eNormal - gTangent);
  }
`
