/**
 * Конфиг фона сцены. Кубмапа восьмибитная, поэтому самая яркая звезда в ней
 * равна 1.0 и не может пробить порог блума (BLOOM_OPTIONS.luminanceThreshold).
 * Расширение хайлайтов подтягивает верх диапазона за 1.0, оставляя всё ниже
 * порога нетронутым.
 */
export interface BackgroundConfig {
  background: {
    /** Ниже этого значения фон не меняется вовсе */
    highlightThreshold: number
    /** Во сколько раз растягивается превышение порога; 1 — расширение выключено */
    highlightBoost: number
  }
}

export const background: BackgroundConfig = {
  background: {
    highlightThreshold: 0.8,
    highlightBoost: 1
  }
}
