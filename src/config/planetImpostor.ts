/**
 * Точка-импостор планеты (FakePlanet): цвет из Actor.color и фаза.
 *
 * Яркость в полной фазе равна прежнему серому #b6b6b6 — сохранения потока нет
 * намеренно (отложено владельцем, см. заметку impostor-flux).
 */
export interface PlanetImpostorConfig {
  planetImpostor: {
    /** Доля насыщенности Actor.color: 0 — серый, 1 — цвет орбиты как есть */
    saturation: number
    /** Пол фазового множителя: тонкий серп не пропадает совсем */
    phaseFloor: number
  }
}

export const planetImpostor: PlanetImpostorConfig = {
  planetImpostor: {
    saturation: 0.4,
    phaseFloor: 0.05
  }
}
