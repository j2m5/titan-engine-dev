import { toThreeJSUnits } from '@/core/helpers/scaling'

/**
 * Обёртка домена детальных слоёв: патч несёт тело-локальную позицию вершины
 * минус k·W (k общий на патч), чтобы float32 не терял тексели 40/7-метровых
 * тайлов. W = WRAP_TILES периодов слоя; все функции домена в TerrainDetail
 * W-периодичны (текстуры — 1 тайл, value-noise — 256 ячеек по 4 тайла).
 */
export const WRAP_TILES = 1024

export const DEFAULT_DETAIL_SCALE_METERS = 40
export const DEFAULT_DETAIL_SCALE2_METERS = 7

export interface DetailWrap {
  readonly w1: number
  readonly w2: number
}

export function wrapUnitsFor(periodMeters: number): number {
  return WRAP_TILES * toThreeJSUnits(periodMeters / 1000)
}

/** Ручка БД валидна, только если конечное положительное число — иначе период 0/NaN даёт NaN во всём атрибуте. */
function validPeriodMeters(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function detailWrapFor(data: { detailScaleMeters?: number; detailScale2Meters?: number } | undefined): DetailWrap {
  return {
    w1: wrapUnitsFor(validPeriodMeters(data?.detailScaleMeters, DEFAULT_DETAIL_SCALE_METERS)),
    w2: wrapUnitsFor(validPeriodMeters(data?.detailScale2Meters, DEFAULT_DETAIL_SCALE2_METERS))
  }
}

/** Число периодов до центра патча — один k на патч, иначе обёртка рвала бы треугольники. */
export function wrapIndex(centerComponent: number, w: number): number {
  return Math.round(centerComponent / w)
}

export function wrappedComponent(p: number, k: number, w: number): number {
  return p - k * w
}
