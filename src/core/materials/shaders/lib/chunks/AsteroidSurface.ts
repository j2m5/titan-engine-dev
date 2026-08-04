/**
 * GLSL-чанк МАКРО-облика астероида (L0, фрагмент): единый цвет профиля +
 * per-instance джиттер/мотл/maria (идентичность камня, прячет повторы тайла).
 * Домен — направление объектной позиции (сфера-домен, без UV-швов) со сдвигом
 * per-instance. Рельеф и микродеталь (высокочастотное зерно/трещины) даёт
 * фотограмметрический PBR-микрослой (см. чанк TriplanarDetail) — этот чанк
 * отвечает только за крупную композицию альбедо, нормаль не трогает.
 *
 * tintSeed/domainOffset приходят аргументами из вершинника, а не выводятся из
 * сида здесь: хеш от интерполированного varying усиливает ULP-джиттер
 * интерполяции до пиксельного шума — «сетки» по фасетам.
 *
 * Зависит от snoise: фрагмент обязан включить <noiseFunctions> перед
 * <asteroidSurfaceFunctions>.
 */
export const asteroidSurfaceFunctions = `
  // Композит облика: макро-альбедо (джиттер + мотл + maria). dir — нормали-
  // зованная объектная позиция (домен); tintSeed/domainOffset — пер-инстансные
  // хеши, вычисленные в ВЕРШИННИКЕ (см. докблок модуля про ULP-джиттер).
  vec3 applyAsteroidSurface(vec3 dir, float tintSeed, vec3 domainOffset, vec3 baseColor, float colorJitter, float tintStrength, float mariaStrength) {
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
