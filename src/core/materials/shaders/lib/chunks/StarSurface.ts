/**
 * Формулы поверхности звезды, общие для диска (StarShaderTemplate, через
 * #include <starSurface>) и билборда-импостора (FakeStarShaderTemplate,
 * интерполяцией строки) — паттерн BLACKBODY_GLSL у чёрной дыры: одна
 * формула, два LOD-потребителя, рассинхронизация невозможна без правки
 * чанка.
 *
 * Зависимость: snoise(vec4) из noiseFunctions — потребитель обязан включить
 * его ДО этого чанка.
 */
export const starSurface = `
  float fbm(vec4 pos, int octaves, float persistence) {
    float total = 0.0;
    float frequency = 1.0;
    float amplitude = 1.0;
    float maxValue = 0.0;

    for(int i = 0; i < octaves; i++) {
      total += snoise(pos * frequency) * amplitude;

      maxValue += amplitude;

      amplitude *= persistence;
      frequency *= 2.0;
    }

    return total / maxValue;
  }

  // Экранный масштаб домена шума: сколько единиц домена приходится на пиксель
  // по более крутому из экранных направлений x/y.
  //
  // Мера уже учитывает проекцию и разрешение: отдельные пороги для радиуса,
  // fov и высоты окна не нужны. Диск и билборд используют одну
  // шкалу фильтрации; на дистанции LOD у проверенных звёзд весь спектр уже
  // погашен. Совпадение интегрального RGB проверяет lodPhotometry.gpu.ts.
  float starDomainPerPixel(vec3 domainPos) {
    return max(length(dFdx(domainPos)), length(dFdy(domainPos)));
  }

  // Общее гашение, сохранённое для giantStarSurface. Главная последовательность
  // использует ниже фильтрацию отдельных октав. Ячейка базовой октавы ≈ 1
  // единица домена, поэтому пороги — обратные величины размера ячейки в
  // пикселях: 0.15 это ~6.7 px (ниже зерно начинает распадаться), 0.6 это
  // ~1.7 px. Это художественные пороги общего затухания.
  float starGranulationFade(float domainPerPixel) {
    return 1.0 - smoothstep(0.15, 0.6, domainPerPixel);
  }

  // Каждая октава ограничена собственным экранным масштабом. Нормировка
  // остаётся полной: удаление мелких деталей не усиливает крупные пятна.
  // Общий fbm выше нужен также другим поверхностям и остаётся без фильтра.
  // Результат: x — отфильтрованный шум, y — дисперсия удалённого спектра.
  vec2 starFilteredFbm(vec4 pos, float domainPerPixel) {
    float total = 0.0, norm = 0.0, missingVariance = 0.0;
    float frequency = 1.0, amplitude = 1.0;
    for (int i = 0; i < 6; i++) {
      // Полная октава при периоде >= 2 px, плавное гашение к 1 px.
      // Общий starGranulationFade имеет более ранние художественные пороги
      // и по-прежнему используется другими типами звёзд.
      float weight = 1.0 - smoothstep(0.5, 1.0, domainPerPixel * frequency);
      if (weight > 0.0) total += snoise(pos * frequency) * amplitude * weight;
      missingVariance += amplitude * amplitude * (1.0 - weight * weight);
      norm += amplitude;
      amplitude *= 0.9;
      frequency *= 2.0;
    }
    // Дисперсия snoise(vec4) ≈ 0.0875 (замер по трём временным срезам).
    return vec2(total / norm, 0.0875 * missingVariance / (norm * norm));
  }

  // Чёрнотельная палитра: cool (T-spread) -> base (T) -> hot (T+spread)
  vec3 starGranuleColor(float t, vec3 cool, vec3 base, vec3 hot) {
    return t < 0.5 ? mix(cool, base, t * 2.0) : mix(base, hot, t * 2.0 - 1.0);
  }

  // Горячие ячейки ярче холодных; coreIntensity — базовая HDR-яркость
  float starEnergy(float t, float coreIntensity) {
    return mix(0.55, 3.0, t) * coreIntensity;
  }

  vec3 starGranuleRadiance(float noise, float activity, vec3 cool, vec3 base, vec3 hot) {
    float t = mix(0.5, clamp(0.5 + noise * 4.0, 0.0, 1.0), activity);
    return starGranuleColor(t, cool, base, hot) * starEnergy(t, 1.0);
  }

  // Фильтруем излучение, включая нелинейные clamp и палитру. Удалённые
  // октавы заменены распределением с нулевым средним и потерянной дисперсией.
  // Пять узлов Гаусса—Эрмита требуют только дешёвых оценок цвета, без шума.
  // При полностью разрешённом спектре результат совпадает с прежним.
  vec3 starGranulationRadiance(vec4 noisePos, float activity, float domainPerPixel,
                              vec3 cool, vec3 base, vec3 hot, float coreIntensity) {
    if (activity <= 0.0) return base * starEnergy(0.5, coreIntensity);
    vec2 field = starFilteredFbm(noisePos, domainPerPixel);
    vec3 center = starGranuleRadiance(field.x, activity, cool, base, hot);
    if (field.y <= 0.0) return center * coreIntensity;
    float sigma = sqrt(field.y);
    float inner = 1.35562618 * sigma, outer = 2.85697001 * sigma;
    vec3 radiance = center * 0.53333333;
    radiance += 0.22207592 * (
      starGranuleRadiance(field.x - inner, activity, cool, base, hot) +
      starGranuleRadiance(field.x + inner, activity, cool, base, hot));
    radiance += 0.01125741 * (
      starGranuleRadiance(field.x - outer, activity, cool, base, hot) +
      starGranuleRadiance(field.x + outer, activity, cool, base, hot));
    return radiance * coreIntensity;
  }

  // Лимбовое потемнение: mu — косинус (нормаль, луч на камеру);
  // коэффициент в синем выше -> кромка диска теплеет, как у Солнца
  vec3 starLimb(float mu, vec3 limbCoeff) {
    return clamp(vec3(1.0) - limbCoeff * (1.0 - mu), 0.0, 1.0);
  }
`
