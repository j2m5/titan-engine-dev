/**
 * Лимбовое потемнение из Эддингтона-Барбье, общее для белого карлика и
 * звезды-гиганта. Зависимостей нет.
 *
 * CPU-зеркало: tests/helpers/planckLimbMirror.ts — менять строго синхронно.
 */
export const planckLimb = `
  // Оптическая глубина выхода излучения в приближении Эддингтона
  #define PLANCK_LIMB_EDDINGTON_TAU 0.66666667

  /**
   * Серая атмосфера: T^4(tau) = 0.75 * Teff^4 * (tau + 2/3); под углом mu наружу
   * выходит планковская функция с глубины tau = mu. Отношение яркостей —
   * отношение планковских функций на двух температурах.
   *
   * planckX — hc/(lambda * k * Teff) по каналам R/G/B, считается на CPU. Малый x
   * (горячее тело) даёт плоский диск, большой (холодное) — сильное потемнение.
   *
   * sOne считается тем же выражением, что sMu: иначе при mu = 1 центр диска
   * разойдётся с единицей в последнем бите.
   *
   * Предел при planckX -> 0 равен 0.795, деление безопасно при planckX > 0.
   */
  vec3 planckLimb(float mu, vec3 planckX) {
    float m = clamp(mu, 0.0, 1.0);
    float sMu = pow(0.75 * (m + PLANCK_LIMB_EDDINGTON_TAU), 0.25);
    float sOne = pow(0.75 * (1.0 + PLANCK_LIMB_EDDINGTON_TAU), 0.25);

    return (exp(planckX / sOne) - 1.0) / (exp(planckX / sMu) - 1.0);
  }
`
