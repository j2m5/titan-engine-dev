/**
 * Детализация сфер тел (SphereDetail): грубая сфера по умолчанию, плотная —
 * пока тело крупно в кадре. Валюта порогов — доля высоты кадра (frameCoverage):
 * от разрешения не зависит.
 */
export interface SphereDetailConfig {
  sphereDetail: {
    /**
     * Сегментация грубого уровня (N×N) у всех мешей тел. Прогиб ребра —
     * R·(1−cos(π/N)): при 64 и доле denseCoverage это 0.16 px в 1080p и 0.33 px в 4K
     */
    coarseSegments: number
    /** Доля высоты кадра (2R / высота кадра), с которой строится плотная сфера */
    denseCoverage: number
    /** Доля, ниже которой плотная освобождается. Вдвое ниже denseCoverage — гистерезис, без дрожи на границе */
    coarseCoverage: number
  }
}

export const sphereDetail: SphereDetailConfig = {
  sphereDetail: {
    coarseSegments: 64,
    denseCoverage: 0.25,
    coarseCoverage: 0.125
  }
}
