import { Vector2, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from './heightMapFormat'
import { CUBE_FACES, TERRAIN_PATCH_SEGMENTS, cubeFaceDirection } from './cubeSphere'
import { TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from './terrainQuadtreeSelect'

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
 * `TERRAIN_PATCH_SEGMENTS` сегментов. Калибрует ДВЕ вещи в `buildClearanceGrid`:
 * (а) поточечную модель провиса — вторые разности СОСЕДНИХ текселей корректно
 * ограничивают хорду между соседними вершинами, только пока их шаг ≈ 1
 * тексель (для Луны, карта 8192 текселя, шаг = 8192/16384 = 0.5 текселя —
 * вторые разности соседних текселей чуть шире факта, консервативно); (б)
 * порог перехода на широкое окно у полюсов, где вершинный шаг по долготе
 * растёт как 1/cos(широты) и перестаёт умещаться в соседних текселях.
 */
export const TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS =
  CUBE_EQUATOR_FACES * 2 ** TERRAIN_QUADTREE_MAX_LEVEL * TERRAIN_PATCH_SEGMENTS

/** Базовый запас клиренса поверх провиса — амортизатор под шум карты и погрешность сетки. */
export const CLEARANCE_MARGIN_METERS = 5

/**
 * Блок сетки провиса, texels: чисто плотность/память вывода и калибровка
 * ℓ1/ℓ2 ε-пирамиды (`buildGeometricErrors`) — НЕ окно, по которому меряется
 * провис (это поточечная оценка вторых разностей, см. `buildClearanceGrid`),
 * а размер ячейки, в которую поточечные оценки сворачиваются через MAX.
 * Крупная ячейка здесь безопасна (в отличие от range-агрегации по группе
 * блоков, которая берёт max−min всего окна и может потерять локальный пик
 * провиса при усреднении): чем больше ячейка, тем дальше локальный максимум
 * размазывается дилатацией на соседей — консервативно вверх, никогда не
 * занижает провис внутри ячейки. Для Луны даёт блок = 8 текселей, сетка
 * 1024×512 ≈ 2 МБ.
 */
export const CLEARANCE_GRID_BASE_SEGMENTS = 1024

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
 * Карта провиса (clearance): треугольник визуальной сетки — линейная хорда
 * между соседними ВЕРШИНАМИ максимального уровня квадродерева — отклоняется
 * от честной (билинейной) поверхности только там, где хорда пересекает излом
 * билинейки (границу текселя, где вторая разность высот ненулевая): на
 * гладком (линейном) участке карты провис ≈ 0, растёт только на изломах
 * рельефа (кромки кратеров). Поточечная оценка на тексель — половина
 * максимума |второй разности| по обеим осям карты и перекрёстного члена
 * билинейной ячейки (h00−h10−h01+h11, ограничивает провис внутри треугольника
 * квада) — см. `buildClearanceGrid`. У полюсов, где вершинный шаг по долготе
 * растёт как 1/cos(широты) и перестаёт умещаться в соседних текселях (порог —
 * `TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS`), восток-западная компонента
 * переключается на размах по скользящему окну текселей ширины вершинного
 * шага; север-южная остаётся на второй разности. Поточечные оценки сворачиваются
 * через MAX в ячейки `CLEARANCE_GRID_BASE_SEGMENTS` (плотность/память, не
 * окно — см. докблок константы), затем дилатация 3×3 страхует границы ячеек,
 * чтобы клиренс не обрывался скачком на стыке. Выборка клиренса — билинейная
 * по этой же сетке (см. `clearanceMeters`), а не ближайшая ячейка: иначе пол
 * камеры ступенчатый на границах ячеек.
 *
 * Оговорка, принятая владельцем: при быстром снижении локальная сетка
 * TerrainSphere может на секунды остаться грубее максимального уровня
 * (бюджет `PATCH_BUILDS_PER_FRAME` построек в кадр, гейт `coverageReady`
 * держит старый уровень, пока покрытие детьми не готово) — в этом окне карта
 * провиса уже посчитана под максимальный уровень, а видимая сетка ещё грубее
 * него, и холм теоретически может на глаз транзиентно пройти сквозь камеру.
 * Не лечится здесь: SSE у самой поверхности требует немедленного дробления,
 * окно грубости — доли секунды на PATCH_BUILDS_PER_FRAME построек.
 *
 * Двухслойная модель клиренса: `clearanceMeters`/`maxClearanceMeters`
 * (сетка выше) — СТРАЖ широкой фазы и внешнего марча коллизии: намеренно
 * консервативен (MAX-агрегация поточечных оценок по ячейке
 * `CLEARANCE_GRID_BASE_SEGMENTS` + дилатация 3×3 размазывают пиковый провис
 * на площадь ~блока — честная медиана по Луне ~28 м, после сетки ~236 м,
 * см. хендофф) — гарантирует отсутствие туннеля на свипе, но НЕ годится для
 * итоговой позиции камеры «на полу». `sagMeters` ниже — честный поточечный
 * пол в конкретном направлении, без сеточного размазывания: коллизия
 * (`CameraCollision`) доуточняет им контакт, найденный маршем по сетке.
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
  private readonly metersPerRaw: number
  private readonly equatorStepTexels: number
  private readonly spanCap: number
  /**
   * Максимум поточечного sag по всей карте, метры — числитель липшицева
   * бонда уклона sag-поля в CameraCollision.marchPointwise (знаменатель —
   * `equatorTexelMeters` ниже, локальный по широте марч сам делит на
   * cos(широты) текущего направления, см. её докблок).
   */
  public readonly maxSagMeters: number
  /**
   * Экваториальный тексель, метры — знаменатель бонда уклона sag-поля выше.
   * Sag-поле масштабирует восток-западный градиент как 1/cos(широты)
   * (сходно с texelArc в surfaceNormalLocal), поэтому потребитель делит это
   * значение на cos(широты) СВОЕГО текущего направления, а не здесь — единая
   * per-body константа, локальная поправка считается на каждом шаге марча.
   */
  public readonly equatorTexelMeters: number
  /**
   * Честный (не статистический) пер-узловой максимум высоты квадродерева,
   * метры — уровни `TERRAIN_QUADTREE_MIN_LEVEL..TERRAIN_QUADTREE_MAX_LEVEL`,
   * 6 граней. Питается ЖИВОЙ (не удалён из живых полей) `blockMax` из
   * `buildClearanceGrid` — честный MAX по текселям блока, не p99 (см.
   * докблок `buildNodeMaxHeightPyramid`). Замена статистической оценки
   * «центр+k·ε» (ревью Task 5, фикс-раунд 1, находка №1 — недооценка до 7.4
   * км на смешанном узле с Гавайями, 211 замороженных узлов с видимой сушей
   * на реальной карте): SSE-потолок воды (`terrainQuadtreeSelect`) обязан
   * видеть НАСТОЯЩИЙ пик узла, включая смешанные узлы (центр в океане, край
   * — остров) — только так остров у края узла честно продолжает делиться.
   *
   * Построение ОТЛОЖЕНО до первого `nodeMaxHeightMeters` и закешировано здесь
   * (находка №3 финального ревью water-foundation): пирамида нужна только
   * телам с водой (SSE-потолок в `terrainQuadtreeSelect`), а строилась
   * безусловно в конструкторе КАЖДОГО поля — +37..44 мс на карту, +22.5 мс
   * даже на вырожденной 4×4 карте `constantHeightField` (расход
   * пропорционален числу узлов дерева, 32760, не размеру карты), суммарно
   * ~1.8 с старта на 46 тел, из которых пирамиду реально спрашивают два.
   * Поля шарятся между потребителями в одном треде (см. `terrainHeightFieldFor`)
   * — потокобезопасность лениво построенного кеша не нужна.
   */
  private nodeMaxHeightMetersPyramid: Float32Array | null = null
  /** Входные блоки билдера пирамиды выше — снимок на момент конструктора, живут до первого ленивого построения. */
  private readonly nodeMaxHeightBlock: number
  private readonly nodeMaxHeightBlockMax: Uint16Array
  private readonly nodeMaxHeightBlocksX: number
  private readonly nodeMaxHeightBlocksY: number

  public constructor(
    private readonly map: HeightMapData,
    public readonly radiusKm: number
  ) {
    // block/metersPerRaw — общий по-блочный базис клиренса и ε-пирамиды,
    // считается один раз здесь, а не дублируется в обоих билдерах.
    // equatorStepTexels/spanCap — общая калибровка поточечной формулы,
    // делится сеткой (buildClearanceGrid) и поточечным sagMeters ниже
    const block = Math.max(1, Math.round(map.width / CLEARANCE_GRID_BASE_SEGMENTS))
    this.metersPerRaw = (map.maxMeters - map.minMeters) / 65535
    this.equatorStepTexels = map.width / TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS
    this.spanCap = Math.max(1, Math.floor(map.width / 4))

    const built = this.buildClearanceGrid(block, this.metersPerRaw)
    this.clearanceGrid = built.grid
    this.clearanceGridWidth = built.width
    this.clearanceGridHeight = built.height
    this.maxClearanceMeters = built.maxClearance
    this.maxSagMeters = built.maxSag
    this.equatorTexelMeters = (TWO_PI * radiusKm * 1000) / map.width
    // blockMin/blockMax/blocksX/blocksY служат только ε-пирамиде ниже и
    // ленивому билдеру пирамиды максимумов — не хранятся полями тела целиком
    // (2 МБ на карту Луны), только blockMax переживает конструктор (нужен
    // отложенной пирамиде максимумов)
    this.levelErrorMeters = this.buildGeometricErrors(
      block,
      this.metersPerRaw,
      built.blockMin,
      built.blockMax,
      built.blocksX,
      built.blocksY
    )
    this.nodeMaxHeightBlock = block
    this.nodeMaxHeightBlockMax = built.blockMax
    this.nodeMaxHeightBlocksX = built.blocksX
    this.nodeMaxHeightBlocksY = built.blocksY
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

  /**
   * Радиус водной оболочки в юнитах three.js: R + уровень, БЕЗ рельефа —
   * та же геометрия, что и константное поле воды (`constantHeightField`), но
   * вычисляется на лету по параметру, а не хранится: поле высот делится по
   * (карта, радиус) в `terrainHeightFieldFor` и не знает уровня воды тела —
   * несколько тел с одной картой могут иметь разные уровни (или не иметь его
   * вовсе). Потребитель (`CameraCollision`) берёт max(surfaceRadiusUnits,
   * этот радиус) там, где пол контакта обязан подниматься до воды.
   */
  public waterSurfaceRadiusUnits(waterLevelMeters: number): number {
    return toThreeJSUnits(this.radiusKm + waterLevelMeters / 1000)
  }

  /** Локальный запас на провис визуальной сетки в направлении dir̂, всегда ≥ CLEARANCE_MARGIN_METERS. */
  public clearanceMeters(dir: Vector3): number {
    const uv = this.dirToUv(dir, this.uvScratch)

    return this.sampleClearance(uv.x, uv.y)
  }

  /**
   * Билинейка по сетке провиса — те же полутекселные конвенции, что и
   * `sampleMeters` (wrap по u, кламп по v). Индексы gridW/gridH — это
   * blocksX/blocksY (`buildClearanceGrid`), равномерны только при ширине
   * карты, кратной block — иначе последняя ячейка по каждой оси у́же
   * остальных (Math.ceil), сама интерполяция это не ломает.
   */
  private sampleClearance(u: number, v: number): number {
    const w = this.clearanceGridWidth
    const h = this.clearanceGridHeight
    const grid = this.clearanceGrid

    let x = (u - Math.floor(u)) * w - 0.5
    if (x < 0) x += w
    // f64-округление x+w может дать ровно w — тот же кламп, что в sampleMeters/sampleSag
    const x0 = Math.min(Math.floor(x), w - 1)
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
   * Честный ПОТОЧЕЧНЫЙ провис в направлении dir̂, метры — без сеточного
   * MAX-размазывания (см. докблок класса, двухслойная модель). Формула та
   * же, что и в `buildClearanceGrid` (половина максимума |вторых разностей|
   * по x/y + перекрёстный член билинейной ячейки, полярный гибрид
   * range-по-скользящему-окну при вершинном шаге шире ~1.5 текселя) —
   * вычисляется на лету для четырёх текселей вокруг dir̂ и билинейно
   * блендится теми же полутекселными конвенциями, что `sampleMeters`.
   * Блендинг НАМЕРЕННО кусочно-непрерывный, а не кусочно-константный по
   * текселям — иначе пол камеры ступенчатый на границах текселей (тот же
   * урок этапа 2, что и у сетки клиренса). Побочный эффект: бленд формально
   * может НЕДООЦЕНИТЬ пиковый провис где-то между четырьмя текселями (сама
   * функция провиса не билинейна) — осознанно принято: это честный ПОЛ под
   * камеру (визуальный стражи от протыкания рельефа), не физика, а margin в
   * CameraCollision остаётся сверху; последствие недооценки — не туннель, а
   * не более чем транзиентный клип кромки у самой границы текселя.
   */
  public sagMeters(dir: Vector3): number {
    const uv = this.dirToUv(dir, this.uvScratch)

    return this.sampleSag(uv.x, uv.y)
  }

  private sampleSag(u: number, v: number): number {
    const { width, height } = this.map

    let x = (u - Math.floor(u)) * width - 0.5
    if (x < 0) x += width
    const x0 = Math.min(Math.floor(x), width - 1)
    const x1 = (x0 + 1) % width
    const fx = x - x0

    const y = Math.min(Math.max(Math.min(Math.max(v, 0), 1) * height - 0.5, 0), height - 1)
    const y0 = Math.floor(y)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = y - y0

    const s00 = this.texelSagRaw(x0, y0)
    const s10 = this.texelSagRaw(x1, y0)
    const s01 = this.texelSagRaw(x0, y1)
    const s11 = this.texelSagRaw(x1, y1)

    const raw = (s00 * (1 - fx) + s10 * fx) * (1 - fy) + (s01 * (1 - fx) + s11 * fx) * fy

    return raw * this.metersPerRaw
  }

  /**
   * Поточечная оценка провиса на целочисленном текселе (x,y), raw-единицы —
   * та же формула, что в `buildClearanceGrid`, но БЕЗ пакетной оптимизации
   * (`slidingRangeWrap` строит окно для целой строки разом; здесь — разовый
   * запрос, честный O(span) проход по нужному окну). У экватора span=1 —
   * O(1); у самого полюса span капается на `spanCap` (четверть ширины карты)
   * — дорогой, но редкий случай (камера у полюса), см. замер в хендоффе.
   */
  private texelSagRaw(x: number, y: number): number {
    const { width, height, data } = this.map
    const xLo = x === 0 ? width - 1 : x - 1
    const xHi = x === width - 1 ? 0 : x + 1
    const yLo = y === 0 ? 0 : y - 1
    const yHi = y === height - 1 ? height - 1 : y + 1
    const row = y * width
    const rowLo = yLo * width
    const rowHi = yHi * width
    const raw = data[row + x]

    const d2y = data[rowLo + x] - 2 * raw + data[rowHi + x]
    const cross = raw - data[row + xHi] - data[rowHi + x] + data[rowHi + xHi]
    const nsComponent = 0.5 * Math.abs(d2y)
    const crossComponent = 0.5 * Math.abs(cross)

    const v = (y + 0.5) / height
    const cosLat = Math.sin(Math.PI * v)
    // ceil, не round: модель вторых разностей честна только при пролёте ≤1
    // текселя — ЛЮБОЕ превышение обязано переключать на широкое окно, round
    // до этого спал бы до порога ~1.5 (round(1.4999…)=1) и держал бы узкую
    // модель в полосе (1, 1.5], где хорда уже перешагивает изломы, которых
    // соседний тексель не видит
    const spanTexels = Math.max(1, Math.min(this.spanCap, Math.ceil(this.equatorStepTexels / cosLat)))

    let ewComponent: number
    if (spanTexels >= 2) {
      let lo = 65535
      let hi = 0
      for (let dx = -spanTexels; dx <= spanTexels; dx++) {
        const xi = ((x + dx) % width + width) % width
        const value = data[row + xi]
        if (value < lo) lo = value
        if (value > hi) hi = value
      }
      ewComponent = hi - lo
    } else {
      const d2x = data[row + xLo] - 2 * raw + data[row + xHi]
      ewComponent = 0.5 * Math.abs(d2x)
    }

    return Math.max(ewComponent, nsComponent, crossComponent)
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
   * Строит сетку провиса за один текселный проход: на каждый тексель —
   * поточечная оценка провиса хорды между соседними вершинами максимального
   * уровня (половина максимума |вторых разностей| по x/y и перекрёстного
   * члена билинейной ячейки — см. докблок класса), на приполярных строках
   * восток-западная компонента вместо этого — размах по скользящему
   * кольцевому окну текселей ширины вершинного шага (`slidingRangeWrap`,
   * O(width) через монотонные деки, а не O(width·span) — у самого полюса
   * окно растёт до четверти ширины карты). Оценки MAX-сворачиваются в ячейки
   * block, затем дилатация 3×3 с запасом. Долгота заворачивается, широта
   * клампится — как всюду в этом классе. Заодно строит blockMin/blockMax
   * (для ε-пирамиды) — тот же по-текселный проход, без лишнего обхода карты.
   */
  private buildClearanceGrid(
    block: number,
    metersPerRaw: number
  ): {
    grid: Float32Array
    width: number
    height: number
    maxClearance: number
    maxSag: number
    blockMin: Uint16Array
    blockMax: Uint16Array
    blocksX: number
    blocksY: number
  } {
    const { width, height, data } = this.map
    const blocksX = Math.ceil(width / block)
    const blocksY = Math.ceil(height / block)

    const blockMin = new Uint16Array(blocksX * blocksY).fill(65535)
    const blockMax = new Uint16Array(blocksX * blocksY)
    const pointSag = new Float32Array(blocksX * blocksY) // raw-единицы, MAX по текселям блока

    const equatorStepTexels = this.equatorStepTexels
    const spanCap = this.spanCap

    // буферы скользящего окна восток-запад для приполярных строк —
    // переиспользуются между строками, без аллокаций в горячем цикле
    const bufLen = width + 2 * spanCap
    const padded = new Uint16Array(bufLen)
    const maxDequeIdx = new Int32Array(bufLen)
    const minDequeIdx = new Int32Array(bufLen)
    const ewRange = new Float32Array(width)

    for (let y = 0; y < height; y++) {
      const by = Math.min(Math.floor(y / block), blocksY - 1)
      const yLo = y === 0 ? 0 : y - 1
      const yHi = y === height - 1 ? height - 1 : y + 1
      const rowLo = yLo * width
      const row = y * width
      const rowHi = yHi * width

      const v = (y + 0.5) / height
      const cosLat = Math.sin(Math.PI * v)
      // ceil (не round — см. texelSagRaw): честна вторая разность только при
      // пролёте ≤1 текселя, порог переключения не должен ждать 1.5
      const spanTexels = Math.max(1, Math.min(spanCap, Math.ceil(equatorStepTexels / cosLat)))
      // пролёт вершины шире 1 текселя — хорда перескакивает изломы, которых
      // вторая разность соседних текселей уже не видит
      const highLat = spanTexels >= 2

      if (highLat) {
        slidingRangeWrap(data, row, width, spanTexels, padded, maxDequeIdx, minDequeIdx, ewRange)
      }

      for (let x = 0; x < width; x++) {
        const xLo = x === 0 ? width - 1 : x - 1
        const xHi = x === width - 1 ? 0 : x + 1

        const raw = data[row + x]
        const b = by * blocksX + Math.min(Math.floor(x / block), blocksX - 1)
        if (raw < blockMin[b]) blockMin[b] = raw
        if (raw > blockMax[b]) blockMax[b] = raw

        const d2y = data[rowLo + x] - 2 * raw + data[rowHi + x]
        const cross = raw - data[row + xHi] - data[rowHi + x] + data[rowHi + xHi]
        const nsComponent = 0.5 * Math.abs(d2y)
        const crossComponent = 0.5 * Math.abs(cross)

        let ewComponent: number
        if (highLat) {
          ewComponent = ewRange[x]
        } else {
          const d2x = data[row + xLo] - 2 * raw + data[row + xHi]
          ewComponent = 0.5 * Math.abs(d2x)
        }

        const sag = Math.max(ewComponent, nsComponent, crossComponent)
        if (sag > pointSag[b]) pointSag[b] = sag
      }
    }

    // максимум ПОТОЧЕЧНОГО (недилатированного) sag по всей карте — max по
    // ячейкам here уже равен max по текселям (каждая ячейка сама max по
    // своим текселям, ассоциативность max) — калибрует maxSagMeters, лишнего
    // прохода по карте не требует
    let maxPointSagRaw = 0
    for (let i = 0; i < pointSag.length; i++) {
      if (pointSag[i] > maxPointSagRaw) maxPointSagRaw = pointSag[i]
    }
    const maxSag = maxPointSagRaw * metersPerRaw

    // дилатация 3×3 + запас: у границ ячеек нет обрывов клиренса
    const grid = new Float32Array(blocksX * blocksY)
    let maxClearance = 0
    for (let cy = 0; cy < blocksY; cy++) {
      for (let cx = 0; cx < blocksX; cx++) {
        let value = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(Math.max(cy + dy, 0), blocksY - 1)
          for (let dx = -1; dx <= 1; dx++) {
            const s = pointSag[ny * blocksX + ((cx + dx + blocksX) % blocksX)]
            if (s > value) value = s
          }
        }
        const c = cy * blocksX + cx
        grid[c] = value * metersPerRaw + CLEARANCE_MARGIN_METERS
        if (grid[c] > maxClearance) maxClearance = grid[c]
      }
    }

    return { grid, width: blocksX, height: blocksY, maxClearance, maxSag, blockMin, blockMax, blocksX, blocksY }
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

  /**
   * Пер-узловой пирамидальный максимум высоты, метры — честный (не p99),
   * заменяет статистическую оценку «центр+k·ε» (ревью Task 5, фикс-раунд 1,
   * находка №1). Два прохода:
   *
   * (1) Лист `TERRAIN_QUADTREE_MAX_LEVEL`: bbox узла в UV карты (9 сэмплов —
   * 4 угла + 4 середины рёбер + центр параметрического квада узла на грани
   * кубосферы, через ту же `cubeFaceDirection`/`dirToUv`, что и мешер/SSE) →
   * диапазон блочных индексов сетки клиренса (±1 блок запаса с каждой
   * стороны) → MAX по `blockMax` в этом диапазоне (сам `blockMax` — честный
   * MAX по текселям блока, не p99). Переоценка bbox 9 сэмплами КОНСЕРВАТИВНА
   * в нужную сторону: равноугольная развёртка нелинейна, но на уровне 6
   * (мелкий угловой охват) кривизна между сэмплами ничтожна относительно
   * запаса в 1 блок — недооценка невозможна, блок только шире охваченного;
   * долгота — циклический анврап относительно центрального сэмпла (узел
   * компактен, ни один сэмпл не может уйти на честные пол-оборота).
   * Полюсный флоат-артефакт: у листьев, упирающихся точно в полюс,
   * atan2(±0, ∓0) отдаёт произвольные 180° (знак нуля IEEE754) — bbox от
   * этого только РАСШИРЯЕТСЯ (замерено ре-ревью: недооценки нет нигде),
   * поэтому не чинится, а документируется.
   *
   * (2) Уровни `MAX_LEVEL-1..MIN_LEVEL`: родитель = MAX четырёх детей —
   * дети точно партиционируют область родителя (квадродерево кубосферы, без
   * пропусков/перекрытий), потому подъём не теряет консервативность и не
   * требует повторного bbox-скана.
   *
   * Память: `6·Σ_{L=1}^{6}4^L` = 32760 записей Float32 ≈ 131 КБ на карту —
   * считается один раз лениво (см. докблок поля `nodeMaxHeightMetersPyramid`),
   * не за кадр.
   */
  private buildNodeMaxHeightPyramid(block: number, blockMax: Uint16Array, blocksX: number, blocksY: number): Float32Array {
    const { width, height, minMeters, maxMeters } = this.map
    const pyramid = new Float32Array(CUBE_FACES * FACE_NODE_COUNT)
    const rawToMeters = (raw: number): number => minMeters + (raw / 65535) * (maxMeters - minMeters)

    // запас в блоках по каждой стороне bbox — покрывает нелинейность
    // равноугольной развёртки между 9 сэмплами узла (см. докблок метода)
    const BLOCK_PAD = 1

    const dirScratch = new Vector3()
    const uvScratch = new Vector2()
    const sampleU = new Float64Array(9)
    const sampleV = new Float64Array(9)

    const leafPatches = 2 ** TERRAIN_QUADTREE_MAX_LEVEL
    const leafSpan = 2 / leafPatches
    const leafOffset = pyramidLevelOffset(TERRAIN_QUADTREE_MAX_LEVEL)

    for (let face = 0; face < CUBE_FACES; face++) {
      for (let i = 0; i < leafPatches; i++) {
        const sLo = -1 + i * leafSpan
        const sHi = sLo + leafSpan
        const sMid = sLo + leafSpan / 2

        for (let j = 0; j < leafPatches; j++) {
          const tLo = -1 + j * leafSpan
          const tHi = tLo + leafSpan
          const tMid = tLo + leafSpan / 2

          // 4 угла + 4 середины рёбер + центр — индекс 8 центр (опорная точка анврапа)
          const sSamples = [sLo, sHi, sLo, sHi, sMid, sMid, sLo, sHi, sMid]
          const tSamples = [tLo, tLo, tHi, tHi, tLo, tHi, tMid, tMid, tMid]

          for (let k = 0; k < 9; k++) {
            cubeFaceDirection(face, sSamples[k], tSamples[k], dirScratch)
            this.dirToUv(dirScratch, uvScratch)
            sampleU[k] = uvScratch.x
            sampleV[k] = uvScratch.y
          }

          const centerU = sampleU[8]
          let uLo = Infinity
          let uHi = -Infinity
          let vLo = Infinity
          let vHi = -Infinity
          for (let k = 0; k < 9; k++) {
            let u = sampleU[k]
            const delta = u - centerU
            if (delta > 0.5) u -= 1
            else if (delta < -0.5) u += 1
            if (u < uLo) uLo = u
            if (u > uHi) uHi = u
            if (sampleV[k] < vLo) vLo = sampleV[k]
            if (sampleV[k] > vHi) vHi = sampleV[k]
          }

          const colLo = Math.floor((uLo * width) / block) - BLOCK_PAD
          const colHi = Math.floor((uHi * width) / block) + BLOCK_PAD
          const rowLo = Math.max(0, Math.floor((vLo * height) / block) - BLOCK_PAD)
          const rowHi = Math.min(blocksY - 1, Math.floor((vHi * height) / block) + BLOCK_PAD)

          let maxRaw = 0
          for (let row = rowLo; row <= rowHi; row++) {
            for (let colRaw = colLo; colRaw <= colHi; colRaw++) {
              const col = ((colRaw % blocksX) + blocksX) % blocksX
              const value = blockMax[row * blocksX + col]
              if (value > maxRaw) maxRaw = value
            }
          }

          pyramid[face * FACE_NODE_COUNT + leafOffset + i * leafPatches + j] = rawToMeters(maxRaw)
        }
      }
    }

    // подъём вверх: родитель = MAX четырёх детей, партиция точная — консервативность не теряется
    for (let level = TERRAIN_QUADTREE_MAX_LEVEL - 1; level >= TERRAIN_QUADTREE_MIN_LEVEL; level--) {
      const patches = 2 ** level
      const childPatches = patches * 2
      const offset = pyramidLevelOffset(level)
      const childOffset = pyramidLevelOffset(level + 1)

      for (let face = 0; face < CUBE_FACES; face++) {
        for (let i = 0; i < patches; i++) {
          for (let j = 0; j < patches; j++) {
            let m = -Infinity
            for (let di = 0; di < 2; di++) {
              for (let dj = 0; dj < 2; dj++) {
                const ci = i * 2 + di
                const cj = j * 2 + dj
                const v = pyramid[face * FACE_NODE_COUNT + childOffset + ci * childPatches + cj]
                if (v > m) m = v
              }
            }
            pyramid[face * FACE_NODE_COUNT + offset + i * patches + j] = m
          }
        }
      }
    }

    return pyramid
  }

  /** ε уровня дерева, метры: p99 размаха высот в окне шага вершинной сетки уровня; ниже блочного разрешения — линейное масштабирование шага. Числитель SSE и глубина юбки. */
  public geometricErrorMeters(level: number): number {
    return this.levelErrorMeters[Math.min(Math.max(level, 1), 6)]
  }

  /**
   * Честный максимум высоты узла квадродерева (face, level, i, j), метры —
   * см. докблок поля `nodeMaxHeightMetersPyramid` и билдера.
   *
   * ЛОВУШКА клампа: `level` вне `[MIN_LEVEL, MAX_LEVEL]` клампится, но `i, j`
   * под клампнутый уровень НЕ пересчитываются — в отличие от
   * `geometricErrorMeters` (у той индексов нет), здесь кламп корректен только
   * при согласованных (level, i, j). Все вызывающие держат level в диапазоне
   * через рекурсию отбора; звать с level вне диапазона и чужими i/j нельзя.
   */
  public nodeMaxHeightMeters(face: number, level: number, i: number, j: number): number {
    const pyramid =
      this.nodeMaxHeightMetersPyramid ??
      (this.nodeMaxHeightMetersPyramid = this.buildNodeMaxHeightPyramid(
        this.nodeMaxHeightBlock,
        this.nodeMaxHeightBlockMax,
        this.nodeMaxHeightBlocksX,
        this.nodeMaxHeightBlocksY
      ))
    const clampedLevel = Math.min(Math.max(level, TERRAIN_QUADTREE_MIN_LEVEL), TERRAIN_QUADTREE_MAX_LEVEL)
    const patches = 2 ** clampedLevel

    return pyramid[face * FACE_NODE_COUNT + pyramidLevelOffset(clampedLevel) + i * patches + j]
  }
}

/**
 * Смещение уровня L (1..MAX_LEVEL) в поддереве ОДНОЙ грани пирамиды максимумов:
 * Σ_{k=1}^{L-1} 4^k = (4^L − 4) / 3 — индексы уровней 1..L−1 уже заняты.
 */
function pyramidLevelOffset(level: number): number {
  return (4 ** level - 4) / 3
}

/** Записей на одну грань в пирамиде максимумов: Σ_{L=1}^{MAX_LEVEL} 4^L = pyramidLevelOffset(MAX_LEVEL+1). */
const FACE_NODE_COUNT = pyramidLevelOffset(TERRAIN_QUADTREE_MAX_LEVEL + 1)

/** 99-й процентиль по копии массива (не мутирует вход): сортировка, индекс floor(0.99·(n−1)). */
function percentile99(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort()
  const idx = Math.floor(0.99 * (sorted.length - 1))

  return sorted[idx]
}

/**
 * Диапазон (max−min) по скользящему кольцевому окну ±span текселей вокруг
 * каждого x в строке row — восток-западная оценка провиса на широтах, где
 * вершинный шаг шире ~1.5 текселя (см. buildClearanceGrid). O(width) через
 * монотонные деки, а не O(width·span): у самого полюса span растёт до
 * четверти ширины карты, наивный проход был бы на порядки дороже. Буферы —
 * аргументы, переиспользуются вызывающим между строками без аллокаций;
 * должны быть длиной ≥ width+2·span (гарантируется вызывающим через spanCap).
 */
function slidingRangeWrap(
  data: Uint16Array,
  row: number,
  width: number,
  span: number,
  padded: Uint16Array,
  maxDequeIdx: Int32Array,
  minDequeIdx: Int32Array,
  out: Float32Array
): void {
  const len = width + 2 * span
  for (let j = 0; j < len; j++) {
    const wrapped = (((j - span) % width) + width) % width
    padded[j] = data[row + wrapped]
  }

  const windowSize = 2 * span + 1
  let maxHead = 0
  let maxTail = 0
  let minHead = 0
  let minTail = 0

  for (let j = 0; j < len; j++) {
    const value = padded[j]

    while (maxTail > maxHead && padded[maxDequeIdx[maxTail - 1]] <= value) maxTail--
    maxDequeIdx[maxTail++] = j
    while (maxDequeIdx[maxHead] <= j - windowSize) maxHead++

    while (minTail > minHead && padded[minDequeIdx[minTail - 1]] >= value) minTail--
    minDequeIdx[minTail++] = j
    while (minDequeIdx[minHead] <= j - windowSize) minHead++

    if (j >= windowSize - 1) {
      const outX = j - windowSize + 1
      out[outX] = padded[maxDequeIdx[maxHead]] - padded[minDequeIdx[minHead]]
    }
  }
}

/**
 * Экземпляр на пару (карта, радиус): мешер и коллизия делят его, пересборка
 * сцены не пересканирует данные — шаренная карта высот у нескольких
 * вымышленных лун разных радиусов легальна, у каждой свой инстанс.
 */
const cache = new WeakMap<HeightMapData, Map<number, TerrainHeightField>>()

function terrainHeightFieldFor(map: HeightMapData, radiusKm: number): TerrainHeightField {
  let byRadius = cache.get(map)
  if (!byRadius) {
    byRadius = new Map()
    cache.set(map, byRadius)
  }

  let field = byRadius.get(radiusKm)
  if (!field) {
    field = new TerrainHeightField(map, radiusKm)
    byRadius.set(radiusKm, field)
  }

  return field
}

export { TerrainHeightField, terrainHeightFieldFor }
