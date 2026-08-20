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
  // по самому крутому экранному направлению.
  //
  // Мера намеренно НЕ расстояние до камеры: она не зависит ни от радиуса
  // звезды, ни от fov, ни от высоты окна. На дистанции переключения LOD диск
  // и билборд занимают одинаковые STAR_IMPOSTOR_PIXELS в одном и том же
  // домене, значит дают одинаковое число, значит гаснут одинаково — шов на
  // стыке невозможен без подгонки констант с двух сторон.
  float starDomainPerPixel(vec3 domainPos) {
    return max(length(dFdx(domainPos)), length(dFdy(domainPos)));
  }

  // Гашение грануляции по экранному масштабу. Ячейка базовой октавы ≈ 1
  // единица домена, поэтому пороги — обратные величины размера ячейки в
  // пикселях: 0.15 это ~6.7 px (ниже зерно начинает распадаться), 0.6 это
  // ~1.7 px (ниже оно уже не зерно, а алиасинг). Для Солнца это видимый
  // диск примерно от 230 px (зерно в полную силу) до 60 px (зерна нет);
  // переключение на импостор происходит на 12 px, то есть заведомо по нулю.
  //
  // Пороги стартовые, приёмку по картинке делает владелец.
  float starGranulationFade(float domainPerPixel) {
    return 1.0 - smoothstep(0.15, 0.6, domainPerPixel);
  }

  // Грануляция: t в [0..1] — «температура ячейки» (0 холодная, 1 горячая).
  // fbm знаковый (среднее 0, σ~0.1): центрируем на 0 и усиливаем ×4 —
  // t покрывает [0..1], грануляция видима; 4.0 — ручка контраста ячеек
  //
  // fade — доля зерна от starGranulationFade. Гасим к 0.5, а не к нулю:
  // t = 0.5 даёт базовый спектральный цвет и середину mix(0.55, 3.0, t), то
  // есть среднюю энергию распределения, — при гашении пропадает зерно, а не
  // яркость диска. Полностью погашенная поверхность ещё и не считает шесть
  // октав 4D-симплекса впустую.
  float starGranulationT(vec4 noisePos, float fade) {
    if (fade <= 0.0) return 0.5;

    return mix(0.5, clamp(0.5 + fbm(noisePos, 6, 0.9) * 4.0, 0.0, 1.0), fade);
  }

  // Чёрнотельная палитра: cool (T-spread) -> base (T) -> hot (T+spread)
  vec3 starGranuleColor(float t, vec3 cool, vec3 base, vec3 hot) {
    return t < 0.5 ? mix(cool, base, t * 2.0) : mix(base, hot, t * 2.0 - 1.0);
  }

  // Горячие ячейки ярче холодных; coreIntensity — базовая HDR-яркость
  float starEnergy(float t, float coreIntensity) {
    return mix(0.55, 3.0, t) * coreIntensity;
  }

  // Лимбовое потемнение: mu — косинус (нормаль, луч на камеру);
  // коэффициент в синем выше -> кромка диска теплеет, как у Солнца
  vec3 starLimb(float mu, vec3 limbCoeff) {
    return clamp(vec3(1.0) - limbCoeff * (1.0 - mu), 0.0, 1.0);
  }
`
