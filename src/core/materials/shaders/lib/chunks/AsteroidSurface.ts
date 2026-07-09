/**
 * GLSL-чанк МАКРО-облика астероида (L0, фрагмент): единый цвет профиля +
 * per-instance джиттер/мотл/maria (идентичность камня, прячет повторы тайла).
 * Домен — направление объектной позиции (сфера-домен, без UV-швов) со сдвигом
 * per-instance. Рельеф и микродеталь (высокочастотное зерно/трещины) даёт
 * фотограмметрический PBR-микрослой (см. чанк TriplanarDetail) — этот чанк
 * отвечает только за крупную композицию альбедо, нормаль не трогает.
 *
 * Процедурные кратеры и fwidth-AA убраны решением владельца после визуальной
 * приёмки (задача 7): рядом с PBR-микрослоем «кривоватые» кратеры ухудшали
 * картинку. Кратеры вернутся врезанными в силуэт в генераторе архетипов
 * (этап 2–3 спеки docs/superpowers/specs) — там же их каверны дадут честный
 * рельеф вместо процедурного возмущения нормали.
 *
 * hashSurface11 остаётся: его использует трипланарный блок шаблона (сдвиг
 * проекции triOffset) — НЕ орфан несмотря на то, что этот чанк его почти не
 * использует сам. Зависит от snoise (chunk noiseFunctions) — фрагмент обязан
 * включить <noiseFunctions> перед <asteroidSurfaceFunctions>.
 */
export const asteroidSurfaceFunctions = `
  // float→float хеш для декоррелированных сидов из per-instance сида
  float hashSurface11(float x) {
    return fract(sin(x * 91.3458) * 47453.5453);
  }

  // Композит облика: макро-альбедо (джиттер + мотл + maria). dir — нормали-
  // зованная объектная позиция (домен); instanceSeed — per-instance константа.
  vec3 applyAsteroidSurface(vec3 dir, float instanceSeed, vec3 baseColor, float colorJitter, float tintStrength, float mariaStrength) {
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
    // низкие, поэтому маска стабильна на расстоянии (не мельтешит). Модулирует
    // ТОЛЬКО базовый цвет — PBR-микрослой ложится поверх.
    float mariaField = 0.7 * snoise(dir * 1.2 + domainOffset * 0.7)
                     + 0.3 * snoise(dir * 2.6 + domainOffset * 1.9);
    float maria = smoothstep(-0.15, 0.35, mariaField);   // мягкие «берега» регионов
    base *= 1.0 - mariaStrength * maria;                 // равнины темнее

    return base;
  }
`
