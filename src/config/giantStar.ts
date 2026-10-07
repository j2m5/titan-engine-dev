/**
 * Звезда-гигант: переключение LOD, прокси-экспозиция.
 *
 * Яркости импостора ручки нет НАМЕРЕННО: билборд зовёт те же функции чанков,
 * что диск и оболочка, любой множитель поверх воссоздал бы шов на переключении.
 */
export interface GiantStarConfig {
  giantStar: {
    /** Гистерезис LOD — доля дистанции переключения (см. star.lodHysteresis) */
    lodHysteresis: number
    /** Пол прокси-экспозиции вплотную к телу; 1 — спада нет */
    proximityExposureFloor: number
    /** Доля высоты кадра, с которой начинается спад; ниже — ровно 1 */
    proximityExposureStart: number
    /** Доля высоты кадра, где спад выходит на пол */
    proximityExposureEnd: number
  }
}

export const giantStar: GiantStarConfig = {
  giantStar: {
    lodHysteresis: 0.05,
    // Пороги стартовые: у гиганта диск во весь кадр — штатный вид, а не прилёт
    proximityExposureFloor: 0.35,
    proximityExposureStart: 0.5,
    proximityExposureEnd: 2.0
  }
}
