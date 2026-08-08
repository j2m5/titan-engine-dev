/**
 * Коричневый карлик: переключение LOD.
 *
 * Яркость импостора ручки не имеет НАМЕРЕННО: билборд сэмплит то же поле
 * облаков через тот же чанк brownDwarfSurface, что и диск, — любой множитель
 * поверх воссоздал бы шов на переключении (тот же контракт, что у config/star.ts).
 */
export interface BrownDwarfConfig {
  brownDwarf: {
    /** Гистерезис LOD — доля дистанции переключения (см. star.lodHysteresis) */
    lodHysteresis: number
  }
}

export const brownDwarf: BrownDwarfConfig = {
  brownDwarf: {
    lodHysteresis: 0.05
  }
}
