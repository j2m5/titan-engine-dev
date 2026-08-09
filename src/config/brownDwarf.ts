/**
 * Коричневый карлик: переключение LOD и ореол.
 *
 * Яркость импостора ручки не имеет НАМЕРЕННО: билборд сэмплит то же поле
 * облаков через тот же чанк brownDwarfSurface, что и диск, — любой множитель
 * поверх воссоздал бы шов на переключении (тот же контракт, что у config/star.ts).
 */
export interface BrownDwarfConfig {
  brownDwarf: {
    /** Гистерезис LOD — доля дистанции переключения (см. star.lodHysteresis) */
    lodHysteresis: number
    /**
     * Прозрачность спрайта-ореола (StarInnerLayer). У звезды 0.03 — карлик
     * тлеет тише. Спрайт не блум и его не заменяет: он висит с
     * `sizeAttenuation: false`, то есть держит постоянный размер в пикселях
     * и остаётся виден на дистанции, где само тело уже меньше пикселя и
     * блуму работать не с чем. Ноль гасит слой.
     */
    haloOpacity: number
  }
}

export const brownDwarf: BrownDwarfConfig = {
  brownDwarf: {
    lodHysteresis: 0.05,
    haloOpacity: 0.015
  }
}
