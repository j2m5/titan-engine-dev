import { smoothstep } from 'three/src/math/MathUtils'
import { frameHeightAt } from '@/core/helpers/apparentSize'

/**
 * Доля высоты кадра, занятая диском тела: 2R к высоте кадра на дистанции до
 * центра. Валюта нарочно безразмерная (не пиксели): адаптация экспозиции
 * зависит от доли поля зрения, а не от разрешения монитора.
 */
export function frameCoverage(radiusUnits: number, distanceUnits: number, fovDegrees: number): number {
  return (2 * radiusUnits) / frameHeightAt(Math.max(distanceUnits, Number.EPSILON), fovDegrees)
}

/**
 * Экспозиция камеры возле слепящего тела: единица, пока диск мельче start,
 * плавный спад до floor к end. Поверхностная яркость тела с дистанцией не
 * меняется (это физика) — меняется адаптация камеры, когда источник занимает
 * всё поле зрения.
 *
 * Ниже start возвращается РОВНО 1: дальний вид и вся калибровка яркости
 * карлика (WHITE_DWARF_DISPLAY_SCALE, потолок HDR) не тронуты ни битом.
 * floor = 1 — точка отката: кривая тождественно единица.
 * Явные гарды на краях обязательны: 1 - (1 - floor) * 1 во float не равен floor (0.09999999999999998), а стражи требуют точного попадания.
 */
export function proximityExposure(coverage: number, floor: number, start: number, end: number): number {
  if (coverage <= start) return 1
  if (coverage >= end) return floor
  return 1 - (1 - floor) * smoothstep(coverage, start, end)
}
