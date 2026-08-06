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

  // Грануляция: t в [0..1] — «температура ячейки» (0 холодная, 1 горячая).
  // fbm знаковый (среднее 0, σ~0.1): центрируем на 0 и усиливаем ×4 —
  // t покрывает [0..1], грануляция видима; 4.0 — ручка контраста ячеек
  float starGranulationT(vec4 noisePos) {
    return clamp(0.5 + fbm(noisePos, 6, 0.9) * 4.0, 0.0, 1.0);
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
