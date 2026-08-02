/**
 * Блик объектива. Эффект чисто экранный: он видит яркие пиксели кадра и рисует
 * для них артефакты, ничего не зная об источниках света — как блум. Позиция
 * звезды в расчёте не участвует и участвовать не должна.
 *
 * Свечением вокруг ярких пикселей владеет `BloomEffect` (`BLOOM_OPTIONS`);
 * здесь только артефакты объектива: призраки и гало.
 */
export interface LensFlareConfig {
  lensFlare: {
    /** Общий множитель артефактов в кадре */
    intensity: number
    /** Сила призраков — зеркальных отражений ярких пикселей через центр кадра */
    ghostAmount: number
    /** Сила гало — кольца вокруг центра кадра */
    haloAmount: number
    /** Разведение каналов в гало, в текселях половинного разрешения */
    chromaticAberration: number
    /** Сила лучей объектива; 0 — маска тождественна и лучей нет */
    starburstAmount: number
  }
}

export const lensFlare: LensFlareConfig = {
  lensFlare: {
    intensity: 0.01,
    ghostAmount: 0.1,
    haloAmount: 0.1,
    chromaticAberration: 10,
    starburstAmount: 0
  }
}
