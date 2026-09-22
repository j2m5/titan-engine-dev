import { toThreeJSUnits } from '@/core/helpers/scaling'

/** Один пиксель по вертикали: поле зрения 50° на 1080 строк */
export const PIXEL_RAD: number = 0.8726646259971648 / 1080
/** Тело крупнее этого числа пикселей рисуется геометрией */
const GEOMETRY_PX: number = 30
/** Тело крупнее этого числа пикселей идёт ближним тиром */
const NEAR_PX: number = 150
/** Гистерезис выхода из ближнего тира — доля от порога входа */
const NEAR_EXIT_FACTOR: number = 1.28
/** Тел в ячейке: ячейка = шаг · ∛512 */
const CELL_BODIES: number = 512
const DEFAULT_CASCADE_COUNT: number = 3

/** Один класс размеров со своей сеткой, радиусом и порогами */
interface CascadeSpec {
  /** Границы класса по размеру тела, км */
  sizeRangeKm: [number, number]
  /** Геометрическое среднее класса, км — от него считаются радиусы и пороги */
  typicalSizeKm: number
  /** Радиус заселения (тело даёт один пиксель), км */
  populationRadiusKm: number
  /** Среднее расстояние между телами класса, км */
  spacingKm: number
  cellSizeKm: number
  cellHeightKm: number
  lodThresholdsKm: { l0: number; l1: number; l0Near: number; l0NearExit: number }
  densityPerUnit: number
  /** Сколько экземпляров каскад требует при полном заселении своего радиуса */
  instanceDemand: number
  /** Окно множителя экземпляра относительно общего габарита (sizeRangeKm[1] всего пояса) */
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
  cascadeCount?: number
}): CascadeSpec[] {
  const [minKm, maxKm] = options.sizeRangeKm
  const count = options.cascadeCount ?? DEFAULT_CASCADE_COUNT
  const ratio = Math.pow(maxKm / minKm, 1 / count)
  const baseTypical = Math.sqrt(minKm * minKm * ratio)

  const specs: CascadeSpec[] = []
  for (let i = 0; i < count; i++) {
    const bandMin = minKm * Math.pow(ratio, i)
    const bandMax = minKm * Math.pow(ratio, i + 1)
    const typicalSizeKm = Math.sqrt(bandMin * bandMax)
    const populationRadiusKm = typicalSizeKm / PIXEL_RAD
    // Шаг пропорционален размеру: угловая густота класса не зависит от класса
    const spacingKm = options.spacingKm * (typicalSizeKm / baseTypical)
    const cellSizeKm = spacingKm * Math.cbrt(CELL_BODIES)
    const spacingTu = toThreeJSUnits(spacingKm)
    const l0Near = typicalSizeKm / (NEAR_PX * PIXEL_RAD)

    specs.push({
      sizeRangeKm: [bandMin, bandMax],
      typicalSizeKm,
      populationRadiusKm,
      spacingKm,
      cellSizeKm,
      cellHeightKm: cellSizeKm,
      lodThresholdsKm: {
        l0: typicalSizeKm / (GEOMETRY_PX * PIXEL_RAD),
        l1: populationRadiusKm,
        l0Near,
        l0NearExit: l0Near * NEAR_EXIT_FACTOR
      },
      densityPerUnit: 1 / (spacingTu * spacingTu),
      instanceDemand: Math.round(
        ((4 / 3) * Math.PI * Math.pow(populationRadiusKm, 3)) / Math.pow(spacingKm, 3)
      ),
      minScale: bandMin / maxKm,
      maxScale: bandMax / maxKm
    })
  }

  return specs
}

export type { CascadeSpec }
