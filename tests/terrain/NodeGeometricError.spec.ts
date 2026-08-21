import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { constantHeightField } from '@/core/terrain/constantHeightField'
import { selectTerrainNodes, TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
import { CUBE_FACES } from '@/core/terrain/cubeSphere'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

/**
 * Пер-узловая ε (числитель SSE). Глобальная ε — один p99 на всё тело, и она
 * по построению обслуживает поверхность одинаково: равнины тесселируются
 * подробнее, чем нужно, а самые шероховатые узлы — грубее, чем обещает ручка
 * sseSplitPixels. Замер на карте с переменной шероховатостью (маска глушит
 * мелкие октавы, как моря против нагорий): половина узлов вдвое глаже
 * глобальной ε, 9% грубее её, самый грубый — в 2.2 раза.
 *
 * Юбки на пер-узловую ε НЕ переводятся намеренно: юбка закрывает недобор
 * ГРУБОГО СОСЕДА, а не свой собственный, и своя (меньшая) ε сузила бы стенку
 * там, где сосед как раз шероховатее. Им остаётся глобальная по-уровневая.
 */
const WIDTH = 2048
const HEIGHT = 1024
const R_KM = 1737.4
const MIN_METERS = 0
const MAX_METERS = 65535

const NORTH_FACE = 2
const SOUTH_FACE = 3
const LEAF_CENTER = 2 ** TERRAIN_QUADTREE_MAX_LEVEL / 2

function makeMap(values: Uint16Array): HeightMapData {
  return { width: WIDTH, height: HEIGHT, minMeters: MIN_METERS, maxMeters: MAX_METERS, data: values }
}

/** Север (верхняя половина строк) шероховатый, юг — идеально гладкий. */
function halfRoughField(): TerrainHeightField {
  const data = new Uint16Array(WIDTH * HEIGHT).fill(30000)

  for (let y = 0; y < HEIGHT / 2; y++) {
    for (let x = 0; x < WIDTH; x++) data[y * WIDTH + x] = (x + y) % 2 === 0 ? 20000 : 40000
  }

  return new TerrainHeightField(makeMap(data), R_KM)
}

describe('TerrainHeightField: пер-узловая ε различает шероховатые и гладкие узлы', () => {
  it('узел над шероховатым полушарием получает ε заметно больше, чем над гладким', () => {
    const field = halfRoughField()

    const rough = field.nodeGeometricErrorMeters(NORTH_FACE, TERRAIN_QUADTREE_MAX_LEVEL, LEAF_CENTER, LEAF_CENTER)
    const smooth = field.nodeGeometricErrorMeters(SOUTH_FACE, TERRAIN_QUADTREE_MAX_LEVEL, LEAF_CENTER, LEAF_CENTER)

    expect(rough).toBeGreaterThan(0)
    expect(smooth).toBeLessThan(rough / 10)
  })

  it('ε родителя не меньше ε любого его ребёнка — иначе спуск по дереву мог бы увеличить ошибку', () => {
    const field = halfRoughField()

    for (let face = 0; face < CUBE_FACES; face++) {
      for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level < TERRAIN_QUADTREE_MAX_LEVEL; level++) {
        const patches = 2 ** level

        for (let i = 0; i < patches; i++) {
          for (let j = 0; j < patches; j++) {
            const parent = field.nodeGeometricErrorMeters(face, level, i, j)

            for (let di = 0; di < 2; di++) {
              for (let dj = 0; dj < 2; dj++) {
                const child = field.nodeGeometricErrorMeters(face, level + 1, i * 2 + di, j * 2 + dj)

                expect(parent).toBeGreaterThanOrEqual(child - 1e-9)
              }
            }
          }
        }
      }
    }
  })

  it('одиночный битый блок не задирает ε НИ ОДНОГО узла — лист берёт второй по величине размах', () => {
    // Артефакт DEM (шов, NODATA, выброс) — один блок с огромным размахом на
    // идеально плоской карте. При свёртке максимумом он поднял бы ε своего
    // листа и всей цепочки предков до корня грани; второй по величине его не
    // видит, потому что соседние блоки плоские.
    const data = new Uint16Array(WIDTH * HEIGHT).fill(30000)
    data[10 * WIDTH + 10] = 65535
    data[10 * WIDTH + 11] = 0

    const field = new TerrainHeightField(makeMap(data), R_KM)

    for (let face = 0; face < CUBE_FACES; face++) {
      for (let i = 0; i < 2 ** TERRAIN_QUADTREE_MAX_LEVEL; i++) {
        for (let j = 0; j < 2 ** TERRAIN_QUADTREE_MAX_LEVEL; j++) {
          expect(field.nodeGeometricErrorMeters(face, TERRAIN_QUADTREE_MAX_LEVEL, i, j)).toBe(0)
        }
      }
    }
  })

  it('константное поле (вода) пер-узловой ε не имеет — падает на по-уровневую, дерево воды не трогается', () => {
    const water = constantHeightField(R_KM, -667.2)

    for (const level of [TERRAIN_QUADTREE_MIN_LEVEL, TERRAIN_QUADTREE_MAX_LEVEL]) {
      expect(water.nodeGeometricErrorMeters(0, level, 0, 0)).toBe(water.geometricErrorMeters(level))
    }
  })
})

describe('selectTerrainNodes: дерево делится по шероховатости МЕСТА, а не тела целиком', () => {
  it('над шероховатым полушарием набор глубже, чем над гладким на той же дистанции', () => {
    const field = halfRoughField()
    const altitudeUnits = toThreeJSUnits(R_KM + 300)

    const deepestOn = (face: number, cameraLocal: Vector3): number => {
      const { leaves } = selectTerrainNodes({
        field,
        cameraLocal,
        frustumLocal: null,
        screenHeight: 1080,
        fovYRadians: (50 * Math.PI) / 180,
        splitPixels: 6,
        mergeFactor: 0.7,
        currentlySplit: new Set()
      })

      return Math.max(...leaves.filter((leaf) => leaf.face === face).map((leaf) => leaf.level))
    }

    const overRough = deepestOn(NORTH_FACE, new Vector3(0, altitudeUnits, 0))
    const overSmooth = deepestOn(SOUTH_FACE, new Vector3(0, -altitudeUnits, 0))

    expect(overRough).toBeGreaterThan(overSmooth)
  })
})

describe('TerrainHeightField: вырожденная карта не отравляет ε', () => {
  it('идеально плоская карта даёт НУЛЕВУЮ ε на всех уровнях, а не NaN', () => {
    // Показатель самоподобия меряется отношением двух p99; на плоской карте
    // обе нулевые, и log2(0/0) = NaN уходит в СТЕПЕНЬ, отравляя все
    // экстраполированные уровни. Ловится только явной проверкой на конечность:
    // `toBe(NaN)` проходит (Object.is(NaN, NaN) === true), а ноль, умноженный
    // на NaN, снова NaN.
    const field = new TerrainHeightField(makeMap(new Uint16Array(WIDTH * HEIGHT).fill(30000)), R_KM)

    for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      expect(Number.isFinite(field.geometricErrorMeters(level))).toBe(true)
      expect(field.geometricErrorMeters(level)).toBe(0)
      expect(Number.isFinite(field.nodeGeometricErrorMeters(0, level, 0, 0))).toBe(true)
    }
  })
})
