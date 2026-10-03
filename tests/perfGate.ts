import { it } from 'vitest'

/**
 * Пины по настенным часам идут только в `npm run test:perf` (`--mode perf`,
 * файлы последовательно): в общем прогоне сотни файлов параллельно растягивают
 * замер в разы, и потолок срабатывает от нагрузки, а не от регресса.
 */
export const PERF_RUN = import.meta.env.MODE === 'perf'

export const itPerf = it.skipIf(!PERF_RUN)
