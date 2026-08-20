import type { HeightMapData } from './heightMapFormat'
import { TerrainHeightField } from './TerrainHeightField'
import { TERRAIN_PATCH_SEGMENTS } from './cubeSphere'
import { TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from './terrainQuadtreeSelect'

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
 * уровня L (equal-angle, cubeSphere.cubeFaceDirection) по КАЖДОЙ оси сетки —
 * угол θ_L = (π/2)/(2^L·TERRAIN_PATCH_SEGMENTS) (консервативно, без
 * tan-растяжения к краю грани — тот же класс допущения, что у остального ε
 * здесь: недооценка у самого угла грани, не занижение в среднем).
 *
 * Худшее ребро мешевой ячейки — не сторона квада вдоль оси, а ЕГО ДИАГОНАЛЬ:
 * `buildTerrainPatchIndex`/рендер триангулируют квад по диагонали, и именно
 * её сагитта — фактический провис визуальной сетки (эта же причина держит
 * MAX(ns, ew, cross) у настоящего рельефа в `TerrainHeightField.buildClearanceGrid`
 * — cross-член там ровно про диагональ билинейной ячейки, см. её докблок;
 * переопределение здесь обязано следовать той же конвенции, а не занижать
 * провис вдвое, беря только осевой шаг — найдено ревью Task 3, фикс-раунд 2).
 * Диагональ квада со сторонами θ_L — угол θ_diag = θ_L·√2 (диагональ
 * КВАДРАТНОЙ ячейки в этой параметризации, шаги по обеим осям равны).
 * Сагитта хорды на сфере радиуса R: ε(L) = R·(1 − cos(θ_diag/2)) — при малых
 * углах это ровно вдвое больше осевой сагитты (сагитта ∝ θ², (√2)²=2).
 *
 * Механизм самотерминируется в фактической SSE-метрике selectTerrainNodes
 * без отдельной ручки: ε(L) убывает ~как 4^-L (угол вдвое мельче на уровень
 * глубже — сагитта на порядок), спуск останавливается, когда спроецированная
 * в пиксели ε(L) падает ниже splitPixels — крупные тела (Земля) делят
 * глубже, мелкие (Луна) мельче, из космоса везде 24 листа (SSE самого
 * MIN_LEVEL уже ниже порога на орбитальной дистанции). Числа — в отчёте Task 3
 * (фикс-раунд 2).
 */
class ConstantHeightField extends TerrainHeightField {
  public geometricErrorMeters(level: number): number {
    // тот же диапазон, что у базовой пирамиды — переопределение обязано
    // клампить по глубине дерева, а не по числам, при которых писалось
    const clamped = Math.min(Math.max(level, TERRAIN_QUADTREE_MIN_LEVEL), TERRAIN_QUADTREE_MAX_LEVEL)
    const theta = CUBE_FACE_ANGLE / (2 ** clamped * TERRAIN_PATCH_SEGMENTS)
    const thetaDiag = theta * Math.SQRT2 // диагональ квада — худшее ребро мешевой ячейки, см. докблок класса

    return this.radiusKm * 1000 * (1 - Math.cos(thetaDiag / 2))
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
