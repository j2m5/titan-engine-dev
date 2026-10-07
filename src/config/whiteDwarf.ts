/**
 * Белый карлик: переключение LOD и прокси-экспозиция.
 *
 * Яркости импостора ручки нет НАМЕРЕННО — билборд зовёт тот же wdShade из
 * чанка whiteDwarfSurface, что и диск; любой множитель поверх воссоздал бы шов
 * на переключении (тот же контракт, что у config/star.ts и config/brownDwarf.ts).
 */
export interface WhiteDwarfConfig {
  whiteDwarf: {
    /** Гистерезис LOD — доля дистанции переключения (см. star.lodHysteresis) */
    lodHysteresis: number
    /**
     * Пол прокси-экспозиции вплотную к телу: доля от откалиброванной яркости,
     * когда диск занимает весь кадр. Физика поверхности не меняется — меняется
     * адаптация камеры к слепящему источнику во всё поле зрения. Точка отката:
     * 1 — спада нет, поведение до фичи (кадр у прилёта заливает белым).
     */
    proximityExposureFloor: number
    /**
     * Доля высоты кадра, с которой начинается спад. Ниже неё экспозиция
     * РОВНО 1 — дальний вид не тронут ни битом. Для ориентира: точка прилёта
     * навигации (3 радиуса) даёт долю около 0.71.
     */
    proximityExposureStart: number
    /** Доля высоты кадра, где спад выходит на пол */
    proximityExposureEnd: number
  }
}

export const whiteDwarf: WhiteDwarfConfig = {
  whiteDwarf: {
    lodHysteresis: 0.05,
    // floor подобран по виду у прилёта (фон обязан остаться живым); start/end стартовые — приёмка за владельцем
    proximityExposureFloor: 0.1,
    proximityExposureStart: 0.1,
    proximityExposureEnd: 0.65
  }
}
