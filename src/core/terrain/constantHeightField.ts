import type { HeightMapData } from './heightMapFormat'
import { TerrainHeightField } from './TerrainHeightField'
import { TERRAIN_PATCH_SEGMENTS } from './cubeSphere'

/**
 * Сторона синтетической карты константного поля. Отбор решает не разрешение
 * карты, а min===max: `sampleMeters` тогда возвращает уровень независимо от
 * raw-байта, размер карты влияет только на дешевизну конструктора
 * `TerrainHeightField`, не на heightMeters/surfaceRadiusUnits.
 */
const CONSTANT_FIELD_SIDE = 4

/** Угловой охват грани куба по каждой параметрической оси (equal-angle развёртка, cubeSphere). */
const CUBE_FACE_ANGLE = Math.PI / 2

/**
 * Поле высот без рельефа, но НЕ без ε. p99 размаха высот (числитель SSE у
 * TerrainHeightField) при min===max честно ноль — но нулевой ε глушит
 * SSE-отбор совсем, и дерево воды не делится НИКОГДА ни на какой дистанции
 * (найдено ревью Task 3, фикс-раунд 1): посадка на воду видит гранёную
 * поверхность MIN_LEVEL-патча, у Земли до ~239 м провиса в центре квада —
 * спека требует деления «по кривизне», не по амплитуде рельефа, которой у
 * воды нет по определению.
 *
 * ε(L) здесь — провис ХОРДЫ визуальной сетки уровня L: та же геометрическая
 * идея, что клиренс/юбка у рельефа (см. докблок TerrainHeightField), но
 * источник кривизны — сама СФЕРА, не рельеф на ней. Вершинный шаг патча
 * уровня L (equal-angle, cubeSphere.cubeFaceDirection) — угол
 * θ_L = (π/2)/(2^L·TERRAIN_PATCH_SEGMENTS) (консервативно, без tan-растяжения
 * к краю грани — тот же класс допущения, что у остального ε здесь: недооценка
 * у самого угла грани, не занижение в среднем). Сагитта хорды между соседними
 * вершинами на сфере радиуса R: ε(L) = R·(1 − cos(θ_L/2)).
 *
 * Механизм самотерминируется в фактической SSE-метрике selectTerrainNodes
 * без отдельной ручки: ε(L) убывает ~как 4^-L (угол вдвое мельче на уровень
 * глубже — сагитта на порядок), спуск останавливается, когда спроецированная
 * в пиксели ε(L) падает ниже splitPixels — крупные тела (Земля) делят
 * глубже, мелкие (Луна) мельче, из космоса везде 24 листа (SSE самого
 * MIN_LEVEL уже ниже порога на орбитальной дистанции). Числа — в отчёте Task 3
 * (фикс-раунд 1).
 */
class ConstantHeightField extends TerrainHeightField {
  public geometricErrorMeters(level: number): number {
    const clamped = Math.min(Math.max(level, 1), 6)
    const theta = CUBE_FACE_ANGLE / (2 ** clamped * TERRAIN_PATCH_SEGMENTS)

    return this.radiusKm * 1000 * (1 - Math.cos(theta / 2))
  }
}

/**
 * Поле высот тела без рельефа — вся карта на одном уровне. Настоящий
 * `TerrainHeightField` (точнее, `ConstantHeightField` — её специализация с
 * ε по кривизне сферы, см. докблок класса) на синтетической карте, не
 * отдельная реализация интерфейса: билинейка, buildTerrainPatchInto и
 * selectTerrainNodes продолжают работать без изменений. `heightMeters` ≡
 * levelMeters, `surfaceRadiusUnits` = radiusKm + levelMeters/1000 —
 * оболочка радиуса «R + уровень», уровень может быть отрицательным.
 */
export function constantHeightField(radiusKm: number, levelMeters: number): TerrainHeightField {
  const map: HeightMapData = {
    width: CONSTANT_FIELD_SIDE,
    height: CONSTANT_FIELD_SIDE,
    minMeters: levelMeters,
    maxMeters: levelMeters,
    data: new Uint16Array(CONSTANT_FIELD_SIDE * CONSTANT_FIELD_SIDE)
  }

  return new ConstantHeightField(map, radiusKm)
}
