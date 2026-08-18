import type { HeightMapData } from './heightMapFormat'
import { TerrainHeightField } from './TerrainHeightField'

/**
 * Сторона синтетической карты константного поля. Отбор решает не разрешение
 * карты, а min===max: `sampleMeters` тогда возвращает уровень независимо от
 * raw-байта, `geometricErrorMeters` (p99 размаха высот) честно вырождается в
 * 0 на любой глубине блочной сетки — размер карты влияет только на дешевизну
 * конструктора, не на результат.
 */
const CONSTANT_FIELD_SIDE = 4

/**
 * Поле высот тела без рельефа — вся карта на одном уровне. Настоящий
 * `TerrainHeightField` на синтетической карте, не отдельная реализация
 * интерфейса: билинейка, ε-пирамида, buildTerrainPatchInto и
 * selectTerrainNodes продолжают работать без изменений, а geometricErrorMeters
 * при min===max ≡ 0 на всех уровнях — это и держит квадродерево на
 * TERRAIN_QUADTREE_MIN_LEVEL (SSE никогда не пробивает порог сплита).
 * `heightMeters` ≡ levelMeters, `surfaceRadiusUnits` = radiusKm + levelMeters/1000
 * — оболочка радиуса «R + уровень», уровень может быть отрицательным.
 */
export function constantHeightField(radiusKm: number, levelMeters: number): TerrainHeightField {
  const map: HeightMapData = {
    width: CONSTANT_FIELD_SIDE,
    height: CONSTANT_FIELD_SIDE,
    minMeters: levelMeters,
    maxMeters: levelMeters,
    data: new Uint16Array(CONSTANT_FIELD_SIDE * CONSTANT_FIELD_SIDE)
  }

  return new TerrainHeightField(map, radiusKm)
}
