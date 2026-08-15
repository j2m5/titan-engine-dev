import { Vector2, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from './heightMapFormat'
import { TERRAIN_PATCH_SEGMENTS } from './cubeSphere'
import { TERRAIN_QUADTREE_MAX_LEVEL } from './terrainQuadtreeSelect'

/**
 * Экваториальный пояс кубосферы всегда пересекает ровно 4 из 6 граней (два
 * полюсных остаются целиком в полушариях) — геометрический факт куба, не
 * тюнинг.
 */
const CUBE_EQUATOR_FACES = 4

/**
 * Вершинный шаг ФАКТИЧЕСКИ рендерящейся сетки на экваторе, в текселях карты
 * высот: у поверхности квадродерево (этап 3б) всегда на максимальном уровне
 * `TERRAIN_QUADTREE_MAX_LEVEL`, там `2^level` патчей на ребро грани, каждый —
 * `TERRAIN_PATCH_SEGMENTS` сегментов. Раньше здесь была `TERRAIN_SPHERE_SEGMENTS`
 * (разрешение снесённой в 3б монолитной сферы этапа 2, 1024) — окно провиса
 * мерялось под мертвую геометрию и завышало клиренс на порядки (для Луны —
 * километры вместо метров, камера не могла сесть). Для Луны (карта 8192
 * текселя) это даёт 16384 — сетка гуще карты вдвое, окно проседает ниже
 * одного текселя и клампится в конструкторе.
 */
export const TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS =
  CUBE_EQUATOR_FACES * 2 ** TERRAIN_QUADTREE_MAX_LEVEL * TERRAIN_PATCH_SEGMENTS

/** Базовый запас клиренса поверх провиса — амортизатор под шум карты и погрешность сетки. */
export const CLEARANCE_MARGIN_METERS = 5

/**
 * Сторона группы блоков, формирующей одну ячейку сетки провиса. 1 = ячейка
 * совпадает с блоком (для Луны при окне максимального уровня квадродерева
 * блок = 1 тексель ⇒ сетка 8192×4096, ~134 МБ). Крупнее нельзя: широкая
 * ячейка с дилатацией распространяет худший кратер на сотни километров
 * вокруг — клиренс завышается на порядки против фактического провиса сетки
 * (это и была суть бага, чинившегося сужением окна — раздувать ячейку назад
 * ради памяти воскресило бы тот же баг на масштабе ячейки). Память — прямая
 * цена честного окна, не оптимизирована этим фиксом.
 */
const CLEARANCE_CELL_BLOCKS = 1

const TWO_PI = 2 * Math.PI

/**
 * Канонический владелец высот тела: единственный ответ на вопрос «какова
 * высота поверхности в направлении dir̂». Мешер (buildTerrainPatchGeometry) и
 * коллизия (CameraCollision) зовут одну и ту же функцию — требование
 * роадмапа «честный CPU-мешер». Сюда же этап 4 добавит процедурные октавы
 * (слагаемое в heightMeters), сигнатуры не изменятся.
 *
 * Конвенции канонические: тексель i центрован на (i+0.5)/N (как texture2D и
 * slope-энкодер), dirToUv побайтно совпадает с развёрткой SphereGeometry —
 * закреплено паритетным тестом, не выводом.
 *
 * Карта провиса (clearance): треугольник визуальной сетки натянут над честной
 * высотой не выше локального размаха высот в своём пролёте — окно вершинной
 * сетки максимального уровня квадродерева (width/TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS
 * текселей, для Луны < 1, клампится до 1). Ячейка сетки провиса = один блок;
 * группы (1+span)×2 соседних блоков накрывают любое положение скользящего
 * окна вершинной сетки, где span растёт к полюсу как 1/cos(широты) — окно
 * расширяется к полюсам паритетно фактическому пролёту патча кубосферы (см.
 * `buildClearanceGrid`), не «консервативным» запасом. Финальная дилатация 3×3
 * страхует границы ячеек, чтобы клиренс не обрывался скачком на стыке.
 * Выборка клиренса — билинейная по этой же сетке (см. `clearanceMeters`), а
 * не ближайшая ячейка: иначе пол камеры ступенчатый на границах ячеек.
 *
 * Оговорка, принятая владельцем: при быстром снижении локальная сетка
 * TerrainSphere может на секунды остаться грубее максимального уровня
 * (бюджет `PATCH_BUILDS_PER_FRAME` построек в кадр, гейт `coverageReady`
 * держит старый уровень, пока покрытие детьми не готово) — в этом окне карта
 * провиса уже посчитана под максимальный уровень, а видимая сетка ещё грубее
 * него, и холм теоретически может на глаз транзиентно пройти сквозь камеру.
 * Не лечится здесь: SSE у самой поверхности требует немедленного дробления,
 * окно грубости — доли секунды на PATCH_BUILDS_PER_FRAME построек.
 */
class TerrainHeightField {
  private readonly uvScratch = new Vector2()
  private readonly eastScratch = new Vector3()
  private readonly northScratch = new Vector3()
  private static readonly UP = new Vector3(0, 1, 0)
  private readonly clearanceGrid: Float32Array
  private readonly clearanceGridWidth: number
  private readonly clearanceGridHeight: number
  public readonly maxClearanceMeters: number
  private readonly levelErrorMeters: Float64Array

  public constructor(
    private readonly map: HeightMapData,
    public readonly radiusKm: number
  ) {
    // block/metersPerRaw — общий по-блочный базис клиренса и ε-пирамиды,
    // считается один раз здесь, а не дублируется в обоих билдерах
    const block = Math.max(1, Math.round(map.width / TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS))
    const metersPerRaw = (map.maxMeters - map.minMeters) / 65535

    const built = this.buildClearanceGrid(block, metersPerRaw)
    this.clearanceGrid = built.grid
    this.clearanceGridWidth = built.width
    this.clearanceGridHeight = built.height
    this.maxClearanceMeters = built.maxClearance
    // blockMin/blockMax/blocksX/blocksY служат только ε-пирамиде ниже —
    // не хранятся полями тела (2 МБ на карту Луны), передаются аргументами
    this.levelErrorMeters = this.buildGeometricErrors(
      block,
      metersPerRaw,
      built.blockMin,
      built.blockMax,
      built.blocksX,
      built.blocksY
    )
  }

  public get minMeters(): number {
    return this.map.minMeters
  }

  public get maxMeters(): number {
    return this.map.maxMeters
  }

  /**
   * Развёртка SphereGeometry: x = −cos(φ)·sinθ, y = cosθ, z = sin(φ)·sinθ,
   * u = φ/2π, v карты = θ/π (0 = север; у самой геометрии uv.y = 1 − v).
   * dir должен быть нормализован.
   */
  public dirToUv(dir: Vector3, out: Vector2): Vector2 {
    let phi = Math.atan2(dir.z, -dir.x)
    if (phi < 0) phi += TWO_PI

    out.x = phi / TWO_PI
    out.y = Math.acos(Math.min(Math.max(dir.y, -1), 1)) / Math.PI

    return out
  }

  /** Билинейка на полутекселях: wrap долготы (шов меридиана), кламп широты (полюса). */
  public sampleMeters(u: number, v: number): number {
    const { width, height, minMeters, maxMeters, data } = this.map

    let x = (u - Math.floor(u)) * width - 0.5
    if (x < 0) x += width
    // f64-округление x+width может дать ровно width — кламп в последний тексель, fx=1 доносит вес до текселя 0
    const x0 = Math.min(Math.floor(x), width - 1)
    const x1 = (x0 + 1) % width
    const fx = x - x0

    const y = Math.min(Math.max(Math.min(Math.max(v, 0), 1) * height - 0.5, 0), height - 1)
    const y0 = Math.floor(y)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = y - y0

    const h00 = data[y0 * width + x0]
    const h10 = data[y0 * width + x1]
    const h01 = data[y1 * width + x0]
    const h11 = data[y1 * width + x1]

    const raw = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy

    return minMeters + (raw / 65535) * (maxMeters - minMeters)
  }

  public heightMeters(dir: Vector3): number {
    const uv = this.dirToUv(dir, this.uvScratch)

    return this.sampleMeters(uv.x, uv.y)
  }

  public surfaceRadiusUnits(dir: Vector3): number {
    return toThreeJSUnits(this.radiusKm + this.heightMeters(dir) / 1000)
  }

  /** Локальный запас на провис визуальной сетки в направлении dir̂, всегда ≥ CLEARANCE_MARGIN_METERS. */
  public clearanceMeters(dir: Vector3): number {
    const uv = this.dirToUv(dir, this.uvScratch)

    return this.sampleClearance(uv.x, uv.y)
  }

  /**
   * Билинейка по сетке провиса — те же полутекселные конвенции, что и
   * `sampleMeters` (wrap по u, кламп по v). Индексы gridW/gridH выводятся из
   * блочного счёта (`buildClearanceGrid`) и равномерны только при ширине
   * карты, кратной CLEARANCE_CELL_BLOCKS × block — иначе последняя ячейка
   * по каждой оси у́же остальных (Math.ceil), сама интерполяция это не ломает.
   */
  private sampleClearance(u: number, v: number): number {
    const w = this.clearanceGridWidth
    const h = this.clearanceGridHeight
    const grid = this.clearanceGrid

    let x = (u - Math.floor(u)) * w - 0.5
    if (x < 0) x += w
    const x0 = Math.floor(x)
    const x1 = (x0 + 1) % w
    const fx = x - x0

    const y = Math.min(Math.max(Math.min(Math.max(v, 0), 1) * h - 0.5, 0), h - 1)
    const y0 = Math.floor(y)
    const y1 = Math.min(y0 + 1, h - 1)
    const fy = y - y0

    const c00 = grid[y0 * w + x0]
    const c10 = grid[y0 * w + x1]
    const c01 = grid[y1 * w + x0]
    const c11 = grid[y1 * w + x1]

    return (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy
  }

  /** Радиус коллизии: поверхность плюс клиренс, оба в юнитах three.js. */
  public collisionRadiusUnits(dir: Vector3): number {
    return this.surfaceRadiusUnits(dir) + toThreeJSUnits(this.clearanceMeters(dir) / 1000)
  }

  /**
   * Нормаль поверхности из градиента карты — для скольжения камеры. Метрический
   * базис по-восточному расширяется как в slope-энкодере: у полюсов ±1 тексель
   * усиливал бы квантование высот в 1/cos раз.
   */
  public surfaceNormalLocal(dir: Vector3, out: Vector3): Vector3 {
    const east = this.eastScratch.copy(TerrainHeightField.UP).cross(dir)
    const cosLat = east.length()

    if (cosLat < 1e-4) return out.copy(dir) // полюс: тангенс вырожден

    east.divideScalar(cosLat)
    const north = this.northScratch.copy(dir).cross(east)

    const { width, height } = this.map
    const uv = this.dirToUv(dir, this.uvScratch)
    const radiusMeters = this.radiusKm * 1000

    const span = Math.max(1, Math.min(Math.floor(width / 4), Math.round(1 / cosLat)))
    const texelArc = (2 * Math.PI * radiusMeters * cosLat) / width
    const northArc = (Math.PI * radiusMeters) / height

    const gradEast =
      (this.sampleMeters(uv.x + span / width, uv.y) - this.sampleMeters(uv.x - span / width, uv.y)) /
      (2 * span * texelArc)
    const gradNorth =
      (this.sampleMeters(uv.x, uv.y - 1 / height) - this.sampleMeters(uv.x, uv.y + 1 / height)) / (2 * northArc)

    return out.copy(dir).addScaledVector(east, -gradEast).addScaledVector(north, -gradNorth).normalize()
  }

  /**
   * Строит сетку провиса за два прохода (по-блочные min/max → провис ячейки
   * из групп (1+span)×2 блоков, span растёт к полюсу как 1/cos широты
   * строки) и дилатацию 3×3 с запасом. Долгота заворачивается, широта
   * клампится — как всюду в этом классе.
   */
  private buildClearanceGrid(
    block: number,
    metersPerRaw: number
  ): {
    grid: Float32Array
    width: number
    height: number
    maxClearance: number
    blockMin: Uint16Array
    blockMax: Uint16Array
    blocksX: number
    blocksY: number
  } {
    const { width, height, data } = this.map
    const blocksX = Math.ceil(width / block)
    const blocksY = Math.ceil(height / block)

    // проход 1: по-блочные min/max (raw)
    const blockMin = new Uint16Array(blocksX * blocksY).fill(65535)
    const blockMax = new Uint16Array(blocksX * blocksY)
    for (let y = 0; y < height; y++) {
      const by = Math.min(Math.floor(y / block), blocksY - 1)
      for (let x = 0; x < width; x++) {
        const b = by * blocksX + Math.min(Math.floor(x / block), blocksX - 1)
        const raw = data[y * width + x]
        if (raw < blockMin[b]) blockMin[b] = raw
        if (raw > blockMax[b]) blockMax[b] = raw
      }
    }

    // проход 2: провис ячейки = max по группам (1+span)×2 блоков. Колоночный
    // span растёт к полюсу как 1/cos(lat) — идиома surfaceNormalLocal: патч
    // кубосферы у полюса накрывает по долготе кратно больше колонок текселей,
    // чем у экватора (равноугольная развёртка сужается к полюсу), окно
    // группировки обязано расти синхронно, иначе провис там недооценивается.
    // Кап floor(blocksX/4) — та же защита от вырождения у самого полюса, что
    // и в surfaceNormalLocal, но в единицах блоков (домен здесь — blocksX, не
    // тексели карты).
    const gridW = Math.ceil(blocksX / CLEARANCE_CELL_BLOCKS)
    const gridH = Math.ceil(blocksY / CLEARANCE_CELL_BLOCKS)
    const spanCap = Math.floor(blocksX / 4)
    const sag = new Float32Array(gridW * gridH)
    for (let by = 0; by < blocksY; by++) {
      const cy = Math.min(Math.floor(by / CLEARANCE_CELL_BLOCKS), gridH - 1)

      // широта центра строки блоков — половина-блочная конвенция, как везде в классе
      const rowStart = by * block
      const rowEnd = Math.min(rowStart + block, height)
      const rowCenterV = (rowStart + rowEnd) / (2 * height)
      const cosLat = Math.sin(Math.PI * rowCenterV)
      const span = Math.max(1, Math.min(spanCap, Math.round(1 / cosLat)))

      for (let bx = 0; bx < blocksX; bx++) {
        const cx = Math.min(Math.floor(bx / CLEARANCE_CELL_BLOCKS), gridW - 1)
        // группа с началом в (bx, by): долгота wrap на span колонок вперёд, широта кламп
        let lo = 65535
        let hi = 0
        for (let dy = 0; dy <= 1; dy++) {
          const ny = Math.min(by + dy, blocksY - 1)
          for (let dx = 0; dx <= span; dx++) {
            const b = ny * blocksX + ((bx + dx) % blocksX)
            if (blockMin[b] < lo) lo = blockMin[b]
            if (blockMax[b] > hi) hi = blockMax[b]
          }
        }
        const range = (hi - lo) * metersPerRaw
        const c = cy * gridW + cx
        if (range > sag[c]) sag[c] = range
      }
    }

    // дилатация 3×3 + запас: у границ ячеек нет обрывов клиренса
    const grid = new Float32Array(gridW * gridH)
    let maxClearance = 0
    for (let cy = 0; cy < gridH; cy++) {
      for (let cx = 0; cx < gridW; cx++) {
        let value = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(Math.max(cy + dy, 0), gridH - 1)
          for (let dx = -1; dx <= 1; dx++) {
            const s = sag[ny * gridW + ((cx + dx + gridW) % gridW)]
            if (s > value) value = s
          }
        }
        const c = cy * gridW + cx
        grid[c] = value + CLEARANCE_MARGIN_METERS
        if (grid[c] > maxClearance) maxClearance = grid[c]
      }
    }

    return { grid, width: gridW, height: gridH, maxClearance, blockMin, blockMax, blocksX, blocksY }
  }

  /**
   * ε-пирамида уровней (числитель SSE, глубина юбки): p99 размаха высот в
   * окне шага вершинной сетки уровня. ℓ1 — окно 2×2 блока (грубее блочного
   * разрешения), ℓ2 — окно 1×1 блок (совпадает с разрешением карты провиса),
   * ℓ≥3 — тот же p99(1×1), линейно смасштабированный вниз отношением
   * шаг_ℓ/блок (шаг мельче блока — самоподобие как консервативная гипотеза).
   * Вычисляется один раз в конструкторе.
   */
  private buildGeometricErrors(
    block: number,
    metersPerRaw: number,
    blockMin: Uint16Array,
    blockMax: Uint16Array,
    blocksX: number,
    blocksY: number
  ): Float64Array {
    const { width } = this.map

    // окно 1×1 блок: размах внутри блока (та же по-блочная сетка, что и провис)
    const ranges1x1 = new Float64Array(blocksX * blocksY)
    for (let i = 0; i < ranges1x1.length; i++) {
      ranges1x1[i] = (blockMax[i] - blockMin[i]) * metersPerRaw
    }
    const p99_1x1 = percentile99(ranges1x1)

    // окно 2×2 блока: скользящее по всем позициям, долгота wrap, широта кламп
    const ranges2x2 = new Float64Array(blocksX * blocksY)
    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        let lo = 65535
        let hi = 0
        for (let dy = 0; dy <= 1; dy++) {
          const ny = Math.min(by + dy, blocksY - 1)
          for (let dx = 0; dx <= 1; dx++) {
            const b = ny * blocksX + ((bx + dx) % blocksX)
            if (blockMin[b] < lo) lo = blockMin[b]
            if (blockMax[b] > hi) hi = blockMax[b]
          }
        }
        ranges2x2[by * blocksX + bx] = (hi - lo) * metersPerRaw
      }
    }
    const p99_2x2 = percentile99(ranges2x2)

    // окно 1×1 при block=1 тексель вырождено (размах одиночного отсчёта
    // всегда 0) — тогда p99(2×2) как консервативная база, юбка не проседает
    const p99_1x1_eff = p99_1x1 > 0 ? p99_1x1 : p99_2x2

    const levelErrorMeters = new Float64Array(7)
    levelErrorMeters[1] = p99_2x2
    levelErrorMeters[2] = p99_1x1_eff
    for (let level = 3; level <= 6; level++) {
      const stepTexels = width / (4 * Math.pow(2, level) * 64)
      const scale = Math.min(1, stepTexels / block)
      levelErrorMeters[level] = p99_1x1_eff * scale
    }

    return levelErrorMeters
  }

  /** ε уровня дерева, метры: p99 размаха высот в окне шага вершинной сетки уровня; ниже блочного разрешения — линейное масштабирование шага. Числитель SSE и глубина юбки. */
  public geometricErrorMeters(level: number): number {
    return this.levelErrorMeters[Math.min(Math.max(level, 1), 6)]
  }
}

/** 99-й процентиль по копии массива (не мутирует вход): сортировка, индекс floor(0.99·(n−1)). */
function percentile99(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort()
  const idx = Math.floor(0.99 * (sorted.length - 1))

  return sorted[idx]
}

/** Один экземпляр на карту: мешер и коллизия делят его, пересборка сцены не пересканирует данные. */
const cache = new WeakMap<HeightMapData, TerrainHeightField>()

function terrainHeightFieldFor(map: HeightMapData, radiusKm: number): TerrainHeightField {
  let field = cache.get(map)

  if (!field) {
    field = new TerrainHeightField(map, radiusKm)
    cache.set(map, field)
  }

  return field
}

export { TerrainHeightField, terrainHeightFieldFor }
