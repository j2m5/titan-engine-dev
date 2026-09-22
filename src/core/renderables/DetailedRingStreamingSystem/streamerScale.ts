import { toThreeJSUnits } from '@/core/helpers/scaling'

/** Все «машинные» числа стримера, выведенные из одного расстояния между камнями */
interface StreamerScale {
  /** Инстансов на единицу площади сцены */
  densityPerUnit: number
  /** Размер сектора, км */
  cellSizeKm: number
  lodThresholdsKm: { l0: number; l1: number; l0Near: number; l0NearExit: number }
}

/** Ячейка колец: их пороги LOD настроены под неё, отсюда и множители ниже */
const REFERENCE_CELL_KM: number = 2000
const MIN_CELL_KM: number = 2000
/** Ячейка не уже 24 расстояний: иначе в секторе меньше ~500 камней и сетка дробится впустую */
const CELL_PER_SPACING: number = 24

/**
 * Пороги LOD — доли ячейки, взятые у колец (2000 км → 6000/12000/2500/3200).
 * Инвариант l0 > l0NearExit + полудиагональ ячейки выполняется при любой ячейке:
 * 3.0 > 1.6 + 0.707.
 */
export function deriveStreamerScale(meanSpacingKm: number): StreamerScale {
  const spacingTu: number = toThreeJSUnits(meanSpacingKm)
  const cellSizeKm: number = Math.max(MIN_CELL_KM, CELL_PER_SPACING * meanSpacingKm)
  const k: number = cellSizeKm / REFERENCE_CELL_KM

  return {
    densityPerUnit: 1 / (spacingTu * spacingTu),
    cellSizeKm,
    lodThresholdsKm: { l0: 6000 * k, l1: 12000 * k, l0Near: 2500 * k, l0NearExit: 3200 * k }
  }
}

/** Окно Near не должно накрывать окно Geometry целиком — иначе тир Geometry недостижим */
export function assertLodInvariant(cellSizeKm: number, t: StreamerScale['lodThresholdsKm']): void {
  const halfDiagonal: number = cellSizeKm * Math.SQRT1_2

  if (t.l0 <= t.l0NearExit + halfDiagonal) {
    throw new Error(
      `LOD: l0 (${t.l0}) обязан быть больше l0NearExit + полудиагональ ячейки (${t.l0NearExit} + ${halfDiagonal.toFixed(0)})`
    )
  }
}

export type { StreamerScale }
