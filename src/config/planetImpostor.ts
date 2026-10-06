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
    /**
     * Порог переключения диска на точку: экранный диаметр тела в пикселях.
     * Считается честной формулой (distanceForApparentSize, ApparentSizeLod)
     * по живым fov и высоте вьюпорта. 3.83 — прежний фактический порог:
     * старая формула с tan(fov) вместо 2·tan(fov/2) при номинальных 3 px и
     * fov 50° переключала на 3·tan 50°/(2·tan 25°) ≈ 3.83 px — точка
     * переключения НЕ сместилась
     */
    lodPixels: number
  }
}

export const planetImpostor: PlanetImpostorConfig = {
  planetImpostor: {
    saturation: 0.4,
    phaseFloor: 0.05,
    lodPixels: 3.83
  }
}
