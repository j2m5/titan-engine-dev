/**
 * Конфиг качества рендеринга чёрных дыр (спецификация §4).
 * Свойства машины, а не объекта: пер-объектные параметры живут
 * в renderingObject.data (IBlackHoleRenderingObject)
 */
export interface BlackHoleQualityConfig {
  /**
   * Шаг интегрирования уравнения Бине по углу, рад.
   * 0.05 — качество (потолок ~188 шагов до 3π), 0.08 — экономия (~118 шагов)
   * Значение связано с MAX_STEPS в BlackHoleShaderTemplate — связку стережёт
   * tests/blackHole/IntegratorBudget.spec.ts
   */
  integrationDphi: number
  /**
   * Порог переключения L0 → L1 (импостор): экранный диаметр зоны
   * симуляции в пикселях, при котором лензирование уже неразличимо.
   * Величина номинальная: дистанцию считают известно-неверной формулой
   * (см. RenderableFactory.createBlackHole), и при fov 50° переключение
   * приходится на lodPixels / 0.783 — для 35 это 44.7 фактических пикселя
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
