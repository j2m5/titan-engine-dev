/**
 * Часы бюджета построек для тестов квадродерева (TerrainSphere.spec,
 * TerrainPatchGroupBudget.spec): РОВНО одна постройка за кадр. Первое чтение
 * кадра — 0 (frameStart), все последующие — 7 мс (> бюджета 6): цикл построек
 * ставит первый патч (при built===0 проверка бюджета пропускается) и выходит
 * на втором кандидате.
 *
 * `startFrame()` обязателен перед КАЖДЫМ `updateObject`: кадр съедает не
 * фиксированное число тиков (один на frameStart плюс по одному на каждого
 * НЕЖИЛОГО кандидата очереди), без сброса фаза уплывает и постройки идут
 * пачками.
 */
export function makeFrameClock(): { nowMs: () => number; startFrame: () => void } {
  let reads = 0
  return { nowMs: (): number => (reads++ === 0 ? 0 : 7), startFrame: (): void => void (reads = 0) }
}
