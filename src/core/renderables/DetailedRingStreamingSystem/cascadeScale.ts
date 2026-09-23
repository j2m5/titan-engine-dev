import { toThreeJSUnits } from '@/core/helpers/scaling'

/** Один пиксель по вертикали: поле зрения 50° на 1080 строк */
export const PIXEL_RAD: number = 0.8726646259971648 / 1080
/**
 * Ячейка — доля радиуса заселения. Тир выбирается НА СЕКТОР целиком, поэтому
 * пороги обязаны быть кратны ячейке, а не угловому размеру тела: при ячейке
 * крупнее порога геометрии сектор не попал бы в ближний тир никогда.
 * Пропорция взята у колец (порог билборда = 6 ячеек); 5 оставляет инварианту
 * LOD запас в 0.09 радиуса при любом шаге.
 */
const CELL_PER_RADIUS: number = 5
/** Доли радиуса заселения для порогов тиров — те же пропорции, что у колец */
const L0_FRACTION: number = 0.5
const NEAR_ENTER_FRACTION: number = 0.208
const NEAR_EXIT_FRACTION: number = 0.267
const DEFAULT_CASCADE_COUNT: number = 3

/** Один класс размеров со своей сеткой, радиусом и порогами */
interface CascadeSpec {
  /** Границы класса по размеру тела, км */
  sizeRangeKm: [number, number]
  /** Геометрическое среднее класса, км — от него считаются радиус и пороги */
  typicalSizeKm: number
  /** Радиус заселения: дистанция, на которой типичное тело даёт один пиксель, км */
  populationRadiusKm: number
  /** Среднее расстояние между телами класса в средней плоскости, км */
  spacingKm: number
  cellSizeKm: number
  cellHeightKm: number
  lodThresholdsKm: { l0: number; l1: number; l0Near: number; l0NearExit: number }
  /**
   * Экземпляров на единицу ПЛОЩАДИ сцены: сетка множит его на площадь сектора и
   * на долю вертикального профиля, поэтому он задаёт итог по всей колонке.
   * Отсюда полутолщина в числителе — без неё объёмная плотность в средней
   * плоскости вышла бы во столько раз меньше нужной, во сколько полутолщина
   * больше шага.
   */
  densityPerUnit: number
  /** Сколько экземпляров каскад требует при полном заселении своего радиуса */
  instanceDemand: number
  /** Окно множителя экземпляра относительно общего габарита (верх диапазона размеров) */
  minScale: number
  maxScale: number
}

/**
 * Каскады из ручек данных. Диапазон размеров делится на геометрические полосы;
 * радиус заселения класса — дистанция, на которой типичное тело даёт один
 * пиксель; шаг растёт пропорционально размеру, отчего угловая густота у всех
 * классов одинакова, а спрос на экземпляры — равный.
 */
export function deriveCascades(options: {
  sizeRangeKm: [number, number]
  spacingKm: number
  /** Полутолщина пояса, км — входит в плотность (см. CascadeSpec.densityPerUnit) */
  halfThicknessKm: number
  cascadeCount?: number
}): CascadeSpec[] {
  const [minKm, maxKm] = options.sizeRangeKm
  const count = options.cascadeCount ?? DEFAULT_CASCADE_COUNT
  const ratio = Math.pow(maxKm / minKm, 1 / count)
  const baseTypical = Math.sqrt(minKm * minKm * ratio)
  const halfThicknessTu = toThreeJSUnits(options.halfThicknessKm)

  const specs: CascadeSpec[] = []
  for (let i = 0; i < count; i++) {
    const bandMin = minKm * Math.pow(ratio, i)
    const bandMax = minKm * Math.pow(ratio, i + 1)
    const typicalSizeKm = Math.sqrt(bandMin * bandMax)
    const populationRadiusKm = typicalSizeKm / PIXEL_RAD
    // Шаг пропорционален размеру: угловая густота класса не зависит от класса
    const spacingKm = options.spacingKm * (typicalSizeKm / baseTypical)
    const cellSizeKm = populationRadiusKm / CELL_PER_RADIUS
    const spacingTu = toThreeJSUnits(spacingKm)

    specs.push({
      sizeRangeKm: [bandMin, bandMax],
      typicalSizeKm,
      populationRadiusKm,
      spacingKm,
      cellSizeKm,
      cellHeightKm: cellSizeKm,
      lodThresholdsKm: {
        l0: populationRadiusKm * L0_FRACTION,
        l1: populationRadiusKm,
        l0Near: populationRadiusKm * NEAR_ENTER_FRACTION,
        l0NearExit: populationRadiusKm * NEAR_EXIT_FRACTION
      },
      densityPerUnit: halfThicknessTu / (spacingTu * spacingTu * spacingTu),
      instanceDemand: Math.round(((4 / 3) * Math.PI * Math.pow(populationRadiusKm, 3)) / Math.pow(spacingKm, 3)),
      minScale: bandMin / maxKm,
      maxScale: bandMax / maxKm
    })
  }

  return specs
}

export type { CascadeSpec }
