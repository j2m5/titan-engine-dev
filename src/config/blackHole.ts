/**
 * Конфиг качества рендеринга чёрных дыр (спецификация §4).
 * Свойства машины, а не объекта: пер-объектные параметры живут
 * в renderingObject.data (IBlackHoleRenderingObject)
 */
export interface BlackHoleQualityConfig {
  /**
   * Шаг интегрирования уравнения Бине по углу, рад.
   * 0.05 — качество (потолок ~188 шагов до 3π), 0.08 — экономия (~118 шагов)
   */
  integrationDphi: number
  /**
   * Порог переключения L0 → L1 (импостор): экранный диаметр зоны
   * симуляции в пикселях, при котором лензирование уже неразличимо
   */
  lodPixels: number
  /**
   * Гистерезис LOD (доля дистанции переключения), защита от мигания
   * на границе: переключение вверх происходит на distance·(1−hysteresis)
   */
  lodHysteresis: number
}

export interface BlackHoleConfig {
  blackHole: BlackHoleQualityConfig
}

export const blackHole: BlackHoleConfig = {
  blackHole: {
    integrationDphi: 0.05,
    lodPixels: 35,
    lodHysteresis: 0.3
  }
}
