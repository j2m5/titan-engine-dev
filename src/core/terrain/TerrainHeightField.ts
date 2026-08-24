import { Vector2, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from './heightMapFormat'
import type { TerrainAuxPayload } from './terrainAuxFormat'
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
 * `TERRAIN_PATCH_SEGMENTS` сегментов. Отсюда берётся вершинный пролёт на
 * любой широте (`шаг/cos(широты)`), а он задаёт и ширину окна кривизнной
 * суммы, и её множитель — см. `sagWindow`/`ewCurvatureRaw`. Для Луны (карта
 * 8192 текселя) экваториальный шаг = 8192/16384 = 0.5 текселя, то есть на
 * экваторе хорда не выходит за пределы одного излома, а к полюсу окно
 * раскрывается непрерывно.
 */
export const TERRAIN_MAX_LEVEL_EQUATOR_SEGMENTS = terrainEquatorSegmentsAtLevel(TERRAIN_QUADTREE_MAX_LEVEL)

/**
 * Сегментов вершинной сетки по экватору на уровне `level`: `2^level` патчей
 * на ребро грани, по `TERRAIN_PATCH_SEGMENTS` сегментов в каждом, четыре
 * грани на пояс. Одна формула на все уровни — и на максимальный (константа
 * выше), и на промежуточные (ε-пирамида, `buildGeometricErrors`). Раньше
 * промежуточные считались своим выражением с зашитыми `4` и `64`: две записи
 * одного и того же, расходящиеся при первой же правке размера патча.
 */
function terrainEquatorSegmentsAtLevel(level: number): number {
  return CUBE_EQUATOR_FACES * 2 ** level * TERRAIN_PATCH_SEGMENTS
}

/**
 * Множитель перехода от шероховатости, замеренной на БЛОЧНОМ масштабе, к
 * ошибке на вершинном шаге уровня. Два режима, граница — тексель: выше него
 * рельеф самоподобен (шаг^H), ниже работает билинейка карты, а она линейна.
 * Общий для по-уровневой ε (`buildGeometricErrors`) и пер-узловой
 * (`buildNodeErrorPyramid`) — две записи этого закона разошлись бы, и SSE
 * поехала бы относительно юбок.
 */
function terrainLevelScale(width: number, level: number, block: number, hurst: number): number {
  const stepTexels = width / terrainEquatorSegmentsAtLevel(level)

  return Math.min(1, Math.max(stepTexels, 1) / block) ** hurst * Math.min(1, stepTexels)
}

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

/**
 * Версия МОДЕЛИ провиса — не формата и не файла: поднимается при любой правке
 * формул `buildClearanceGrid`/`texelSagRaw`/`buildGeometricErrors`, из-за
 * которой прежде посчитанные числа перестают означать то же самое.
 *
 * Смысл ровно один: запечённый компаньон (`terrainAuxFormat`) хранит это число
 * и на расхождении отбрасывается — поле считает блоки сама. Забыть поднять
 * версию значит оставить в ассетах числа старой модели под видом новой, и
 * единственный признак этого — тихо неверный пол камеры. Раскладка файла при
 * такой правке не меняется, поэтому версия формата здесь не помощник.
 */
export const TERRAIN_SAG_MODEL_VERSION = 3

/**
 * Границы показателя самоподобия (Хёрста), в которых ε экстраполируется
 * вглубь дерева. Замеряется он по данным тела (`buildGeometricErrors`), но
 * доверять замеру безоглядно нельзя — карта может оказаться битой или
 * вырожденной, а показатель входит в СТЕПЕНЬ.
 *
 * Верхняя 1 — линейное убывание: смысла в «глаже линейного» нет, и она же
 * держит важное свойство — новая ε НИКОГДА не ниже прежней (при x ≤ 1 и
 * H ≤ 1 всегда x^H ≥ x), то есть смена модели могла только добавить дробления,
 * но не отнять его. Нижняя 0.5 — броуновский рельеф, предел физически
 * осмысленной шероховатости; ниже — не рельеф, а артефакт данных, и без
 * клампа он раздул бы ε на глубоких уровнях в разы.
 */
const MIN_TERRAIN_HURST = 0.5
const MAX_TERRAIN_HURST = 1

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
 * рельефа (кромки кратеров). Поточечная оценка на тексель — максимум трёх
 * компонент: север-южной (половина |второй разности| по широте — вершинный
 * шаг по ней от широты не зависит), перекрёстного члена билинейной ячейки
 * (h00−h10−h01+h11, ограничивает провис внутри треугольника квада) и
 * восток-западной. Последняя считается по КРИВИЗНЕ: `ewCurvatureRaw` —
 * сумма |вторых разностей| в окне вершинного пролёта (`sagWindow`), которое
 * к полюсу раскрывается непрерывно, потому что пролёт по долготе растёт как
 * 1/cos(широты). Размах по окну остался только ПОТОЛКОМ этой оценки: у самого
 * полюса пролёт доходит до сотен текселей и кривизнная сумма перерастает
 * любую реальную амплитуду. До ревью 2026-08-20 (находка №2) на размах
 * переключались целиком при первом же превышении текселя — оценка
 * подскакивала в разы на одной параллели (для карты 8192 — на 60°: 25.7 м →
 * 139.2 м), и пол камеры дёргался вверх на сотню метров при перелёте через
 * широту. Поточечные оценки сворачиваются
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
   * Экваториальная дуга ячейки клиренс-сетки, метры — знаменатель липшицева
   * бонда клиренса во ВНЕШНЕМ марше `CameraCollision.marchTerrain` (числитель
   * — `maxClearanceMeters`): билинейная интерполяция сетки не меняется быстрее
   * maxClearance за ячейку, а E-W дуга ячейки сжимается как cos(широты) —
   * потребитель делит на cos(широты) СВОЕГО текущего направления сам, по тому
   * же контракту, что `equatorTexelMeters` у sag-бонда `marchPointwise`.
   * Производная от радиуса и ширины сетки — формат компаньона не меняет.
   */
  public readonly clearanceCellEquatorArcMeters: number
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
   * Строится безусловно в конструкторе, СИНХРОННО с остальными полями (не
   * лениво) — рулинг владельца, фикс-раунд 2 финального ревью water-foundation:
   * ленивая версия (находка №3 фикс-раунда 1) кешировала не ту структуру —
   * снимок blockMax/blocksX/blocksY переживал конструктор НАВСЕГДА (поле
   * кешируется в `terrainHeightFieldFor` на весь сеанс), это ~1 МиБ на тело
   * против 128 КиБ готовой пирамиды — 46 тел дали бы ~46 МБ вместо 6 МБ.
   * +1.8 с суммарного времени старта на 46 тел приняты рулингом владельца
   * («рост времени загрузки — норма, критерий — рантайм»); память здесь —
   * только сама пирамида, не сырые блоки. Единственное исключение —
   * `null` у КОНСТАНТНОГО поля (`map.minMeters === map.maxMeters`,
   * `constantHeightField` воды): максимум узла тождественно уровню на всей
   * карте, пирамида ему структурно не нужна вовсе (см. `nodeMaxHeightMeters`).
   *
   * СТРОИТСЯ ВСЕМ, читают её двое — и это осознанно (ревью 2026-08-20,
   * находка №5, закрыта решением «не чиним»). Единственный потребитель —
   * потолок подводных патчей суши в `terrainQuadtreeSelect`, а воду в БД
   * имеют 2 тела из 50. Аргументы против условной постройки:
   *
   * (а) после выноса блоков в запечённый компаньон (`terrainAuxFormat`) в
   * рантайме она не стоит НИЧЕГО — читается вью на буфере файла; остаётся
   * 128 КиБ из 2.13 МиБ компаньона, то есть ~6% его размера;
   * (б) поле делится по паре (карта, радиус), а вода — ручка ТЕЛА: карту,
   * шаренную телом с водой и телом без, пришлось бы либо строить дважды,
   * либо всё равно с пирамидой — условие протекло бы в ключ кеша;
   * (в) безусловная пирамида переживает добавление воды телу без пересборки
   * ассета, условная потребовала бы вспомнить про неё и перезалить файл.
   */
  private readonly nodeMaxHeightMetersPyramid: Float32Array | null

  /**
   * Пер-узловая ε — шероховатость МЕСТА вместо одного p99 на всё тело;
   * см. докблок `buildNodeErrorPyramid`. `null` у константного поля (вода):
   * там ε задаётся кривизной сферы и от узла не зависит.
   */
  private readonly nodeErrorMetersPyramid: Float32Array | null

  /**
   * Блоки пришли запечёнными (`map.aux`), а не посчитаны здесь. Честный
   * наблюдаемый признак вместо замера времени: тест «блоки взяты из
   * компаньона, а не пересчитаны» иначе опирался бы на плавающий тайминг.
   * Заодно — то, что видно в дев-предупреждении, когда компаньон потерялся.
   */
  public readonly usedBakedAux: boolean

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
    // единственное, что зависит от РАДИУСА, а не от карты — потому и весь
    // остальной блок ниже запекается пер-карту, а не пер-тело
    this.equatorTexelMeters = (TWO_PI * radiusKm * 1000) / map.width

    // Запечённый компаньон, если он приехал с картой и сошёлся с ней
    // (`HeightFieldStorage` сверяет отпечаток и калибровку ДО прикрепления —
    // сюда payload приходит уже доверенным), иначе — тот же счёт, что и
    // раньше. Это единственная развилка: дальше обе ветки неотличимы.
    const aux: TerrainAuxPayload = map.aux ?? this.computeAux(block)

    this.usedBakedAux = map.aux !== undefined
    this.clearanceGrid = aux.clearanceGrid
    this.clearanceGridWidth = aux.blocksX
    this.clearanceGridHeight = aux.blocksY
    this.clearanceCellEquatorArcMeters = (TWO_PI * radiusKm * 1000) / aux.blocksX
    this.maxClearanceMeters = aux.maxClearanceMeters
    this.maxSagMeters = aux.maxSagMeters
    this.levelErrorMeters = aux.levelErrorMeters
    this.nodeMaxHeightMetersPyramid = aux.nodeMaxHeightMetersPyramid
    this.nodeErrorMetersPyramid = aux.nodeErrorMetersPyramid
  }

  /**
   * Тот самый проход по карте, ради выноса которого заведён компаньон: сетка
   * провиса, ε-пирамида уровней, пирамида честных максимумов узлов. Порядка
   * секунды на карте 8192×4096 — в рантайме это кадр-фриз в момент доезда
   * карты, поэтому штатно результат приходит запечённым
   * (`scripts/build-terrain-aux.ts`), а эта ветка остаётся фолбэком на случай
   * отсутствующего или протухшего компаньона.
   *
   * blockMin/blockMax/blocksX/blocksY служат только ε-пирамиде и билдеру
   * пирамиды максимумов — не хранятся полями тела (2 МБ на карту Луны),
   * передаются аргументами и умирают локалами этого метода.
   */
  private computeAux(block: number): TerrainAuxPayload {
    const built = this.buildClearanceGrid(block, this.metersPerRaw)
    const errors = this.buildGeometricErrors(
      block,
      this.metersPerRaw,
      built.blockMin,
      built.blockMax,
      built.blocksX,
      built.blocksY
    )
    // константное поле (вода): шероховатости нет ни у одного узла, обе
    // пирамиды ему структурно не нужны — ε берётся по-уровневая (кривизна сферы)
    const constantField = this.map.minMeters === this.map.maxMeters

    return {
      blocksX: built.blocksX,
      blocksY: built.blocksY,
      maxClearanceMeters: built.maxClearance,
      maxSagMeters: built.maxSag,
      clearanceGrid: built.grid,
      levelErrorMeters: errors.levelErrorMeters,
      nodeMaxHeightMetersPyramid: constantField
        ? null
        : this.buildNodeMaxHeightPyramid(block, built.blockMax, built.blocksX, built.blocksY),
      nodeErrorMetersPyramid: constantField
        ? null
        : this.buildNodeErrorPyramid(
            block,
            built.blockMin,
            built.blockMax,
            built.blocksX,
            built.blocksY,
            errors.levelErrorMeters,
            errors.anchorMeters,
            errors.wideAnchor
          )
    }
  }

  /**
   * Производное состояние поля для запечки в компаньон. Отдаёт ЖИВЫЕ массивы
   * (не копии): единственный вызывающий — офлайн-скрипт сборки ассета, он их
   * только сериализует, а лишняя копия сетки провиса на 50 тел — лишние
   * 100 МБ пикового heap'а на прогон.
   *
   * Метод существует ровно затем, чтобы второй реализации формул НЕ БЫЛО:
   * скрипт строит настоящее поле и забирает у него посчитанное, поэтому
   * запечённое равно вычисленному по построению, а не по сверке двух кодов
   * (болезнь slope-карт, где энкодер и GLSL-декод держатся ручным контрактом
   * SLOPE_RANGE).
   */
  public exportAux(): TerrainAuxPayload {
    return {
      blocksX: this.clearanceGridWidth,
      blocksY: this.clearanceGridHeight,
      maxClearanceMeters: this.maxClearanceMeters,
      maxSagMeters: this.maxSagMeters,
      clearanceGrid: this.clearanceGrid,
      levelErrorMeters: this.levelErrorMeters,
      nodeMaxHeightMetersPyramid: this.nodeMaxHeightMetersPyramid,
      nodeErrorMetersPyramid: this.nodeErrorMetersPyramid
    }
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
   * же, что и в `buildClearanceGrid` (max из север-южной второй разности,
   * перекрёстного члена билинейной ячейки и кривизнной восток-западной
   * оценки по окну вершинного пролёта, `sagWindow`/`ewCurvatureRaw`) —
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
   * та же формула, что в `buildClearanceGrid` (общие `sagWindow`/
   * `ewCurvatureRaw`), но БЕЗ пакетной оптимизации: там кривизнная сумма и
   * размах строятся для целой строки разом (префиксы и монотонные деки),
   * здесь — разовый запрос, честный O(окно) проход. У экватора окно сжато в
   * тексель — O(1); у самого полюса пролёт капается на `spanCap` (четверть
   * ширины карты) — дорогой, но редкий случай (камера у полюса).
   */
  private texelSagRaw(x: number, y: number): number {
    const { width, height, data } = this.map
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
    const stepTexels = Math.min(this.spanCap, this.equatorStepTexels / cosLat)
    const window = sagWindow(stepTexels, this.spanCap)

    let absD2Sum = absD2At(data, row, width, x)
    for (let i = 1; i <= window.whole; i++) {
      absD2Sum += absD2At(data, row, width, x - i) + absD2At(data, row, width, x + i)
    }
    if (window.fraction > 0) {
      const edge = window.whole + 1
      absD2Sum += window.fraction * (absD2At(data, row, width, x - edge) + absD2At(data, row, width, x + edge))
    }

    let ewComponent = ewCurvatureRaw(stepTexels, absD2Sum)

    if (stepTexels > 1) {
      // потолок-размах: у полюса кривизнная сумма растёт быстрее любой
      // реальной амплитуды (см. докблок ewCurvatureRaw). Окно ±ceil(пролёт) —
      // объединение обеих хорд, примыкающих к текселю
      const span = Math.max(1, Math.min(this.spanCap, Math.ceil(stepTexels)))
      let lo = 65535
      let hi = 0
      for (let dx = -span; dx <= span; dx++) {
        const xi = (((x + dx) % width) + width) % width
        const value = data[row + xi]
        if (value < lo) lo = value
        if (value > hi) hi = value
      }
      ewComponent = Math.min(ewComponent, hi - lo)
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
   * уровня (max из север-южной второй разности, перекрёстного члена
   * билинейной ячейки и кривизнной восток-западной оценки — см. докблок
   * класса). Восток-западная сумма |вторых разностей| берётся по окну
   * вершинного пролёта через ПРЕФИКСЫ строки (O(1) на окно любой ширины —
   * к полюсу оно растёт до четверти карты, и наивный проход был бы
   * квадратичным); её потолок-размах — по тому же окну через монотонные
   * деки (`slidingRangeWrap`, тоже O(width)). Оценки MAX-сворачиваются в ячейки
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
    // кривизнная сумма строки: |вторые разности| и их префиксы — сумма по
    // окну любой ширины за O(1), так что растущее к полюсу окно не делает
    // проход по строке квадратичным
    const absD2Row = new Float64Array(width)
    const absD2Prefix = new Float64Array(width + 1)

    for (let y = 0; y < height; y++) {
      const by = Math.min(Math.floor(y / block), blocksY - 1)
      const yLo = y === 0 ? 0 : y - 1
      const yHi = y === height - 1 ? height - 1 : y + 1
      const rowLo = yLo * width
      const row = y * width
      const rowHi = yHi * width

      const v = (y + 0.5) / height
      const cosLat = Math.sin(Math.PI * v)
      // Вершинный пролёт максимального уровня в текселях. Округления НЕТ —
      // ни ceil, ни round: окно кривизнной суммы растёт непрерывно (дробный
      // вес крайней пары, см. sagWindow), и порог округления, который прежде
      // и создавал ступеньку оценки на широте, здесь просто не нужен
      const stepTexels = Math.min(spanCap, equatorStepTexels / cosLat)
      const window = sagWindow(stepTexels, spanCap)
      // потолок-размах нужен только там, где пролёт шире текселя: ниже
      // половина второй разности размах не пробивает никогда (см. ewCurvatureRaw)
      const capped = stepTexels > 1

      if (capped) {
        const span = Math.max(1, Math.min(spanCap, Math.ceil(stepTexels)))
        slidingRangeWrap(data, row, width, span, padded, maxDequeIdx, minDequeIdx, ewRange)
      }

      for (let x = 0; x < width; x++) absD2Row[x] = absD2At(data, row, width, x)
      for (let x = 0; x < width; x++) absD2Prefix[x + 1] = absD2Prefix[x] + absD2Row[x]
      const absD2Total = absD2Prefix[width]

      for (let x = 0; x < width; x++) {
        const xHi = x === width - 1 ? 0 : x + 1

        const raw = data[row + x]
        const b = by * blocksX + Math.min(Math.floor(x / block), blocksX - 1)
        if (raw < blockMin[b]) blockMin[b] = raw
        if (raw > blockMax[b]) blockMax[b] = raw

        const d2y = data[rowLo + x] - 2 * raw + data[rowHi + x]
        const cross = raw - data[row + xHi] - data[rowHi + x] + data[rowHi + xHi]
        const nsComponent = 0.5 * Math.abs(d2y)
        const crossComponent = 0.5 * Math.abs(cross)

        let absD2Sum = circularSum(absD2Prefix, absD2Total, width, x - window.whole, 2 * window.whole + 1)
        if (window.fraction > 0) {
          const edge = window.whole + 1
          absD2Sum +=
            window.fraction * (absD2Row[(((x - edge) % width) + width) % width] + absD2Row[(x + edge) % width])
        }

        let ewComponent = ewCurvatureRaw(stepTexels, absD2Sum)
        if (capped) ewComponent = Math.min(ewComponent, ewRange[x])

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
   * окне шага вершинной сетки уровня. Замеряется она РОВНО НА ДВУХ окнах —
   * ℓ1 (2×2 блока) и ℓ2 (1×1 блок, оно же разрешение карты провиса), — а
   * глубже экстраполируется, и закон экстраполяции здесь несущий.
   *
   * Он был линейным: «шаг вдвое мельче — ε вдвое меньше». Рельеф же
   * САМОПОДОБЕН: размах падает как шаг^H, где H (показатель Хёрста) у
   * планетных DEM 0.6–0.9, то есть заметно медленнее линейного. Занижение
   * от этого не постоянное, а НАКАПЛИВАЮЩЕЕСЯ с глубиной — замер на fBm с
   * энергией до Найквиста (карта 8192×4096, H=0.74): ε/честный p99 держался
   * 0.89 на измеренном ℓ2 и падал до 0.58 на ℓ6. Видимое следствие —
   * рельеф грубее, чем обещает ручка sseSplitPixels, и тем сильнее, чем
   * глубже уровень: полная детализация приходила на 50 км вместо 90.
   *
   * H не ручка и не константа — он замеряется по ТЕМ ЖЕ двум окнам, что уже
   * посчитаны: окно ℓ1 ровно вдвое шире окна ℓ2, значит их отношение и есть
   * 2^H. Проверено на синтетике с заданным показателем: замер по паре давал
   * 0.65 / 0.78 / 0.90 против заложенных 0.6 / 0.75 / 0.9.
   *
   * Ниже ТЕКСЕЛЯ самоподобие кончается: там уже не рельеф, а билинейка
   * карты, и она линейна — поэтому фрактальный закон работает до текселя,
   * а дальше ε падает ровно как шаг.
   *
   * Вычисляется один раз в конструкторе (и запекается в компаньон —
   * `TERRAIN_SAG_MODEL_VERSION` поднят, старые файлы отбраковываются).
   */
  private buildGeometricErrors(
    block: number,
    metersPerRaw: number,
    blockMin: Uint16Array,
    blockMax: Uint16Array,
    blocksX: number,
    blocksY: number
  ): { levelErrorMeters: Float64Array; anchorMeters: number; wideAnchor: boolean } {
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

    // Уровни 1 и 2 названы поимённо не по глубине дерева, а по БЛОЧНОМУ
    // базису: вершинный шаг ℓ2 равен ровно блоку, шаг ℓ1 — двум блокам
    // (`width / 2^(level+8)` против `block = width / CLEARANCE_GRID_BASE_SEGMENTS`
    // при TERRAIN_PATCH_SEGMENTS = 64 и CUBE_EQUATOR_FACES = 4). От
    // TERRAIN_QUADTREE_MAX_LEVEL эта пара не зависит вовсе — сдвинуть её
    // может только смена размера патча или базиса сетки провиса.
    const levelErrorMeters = new Float64Array(TERRAIN_QUADTREE_MAX_LEVEL + 1)
    levelErrorMeters[TERRAIN_QUADTREE_MIN_LEVEL] = p99_2x2
    levelErrorMeters[TERRAIN_QUADTREE_MIN_LEVEL + 1] = p99_1x1_eff

    // Показатель самоподобия рельефа, замеренный по ТЕМ ЖЕ двум окнам, что
    // уже посчитаны: окно ℓ1 ровно вдвое шире окна ℓ2, значит отношение их
    // p99 и есть 2^H. Своей ручки не заводится — H берётся из данных тела.
    // Плоская карта (обе p99 нулевые) отношения не имеет: log2(0/0) — NaN, и
    // он ушёл бы в СТЕПЕНЬ, отравив ε всех экстраполированных уровней. Ловится
    // только явной проверкой: `toBe(NaN)` в тестах проходит (Object.is(NaN,
    // NaN) — true), а ноль на NaN даёт снова NaN, не ноль.
    const hurst =
      p99_2x2 > 0 && p99_1x1_eff > 0
        ? Math.min(MAX_TERRAIN_HURST, Math.max(MIN_TERRAIN_HURST, Math.log2(p99_2x2 / p99_1x1_eff)))
        : MAX_TERRAIN_HURST

    for (let level = TERRAIN_QUADTREE_MIN_LEVEL + 2; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      levelErrorMeters[level] = p99_1x1_eff * terrainLevelScale(width, level, block, hurst)
    }

    return { levelErrorMeters, anchorMeters: p99_1x1_eff, wideAnchor: !(p99_1x1 > 0) }
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
   * посчитано один раз в конструкторе (кроме константного поля, см. докблок
   * поля `nodeMaxHeightMetersPyramid`), не за кадр.
   */
  /**
   * Обход листьев квадродерева с bbox каждого в блоках сетки — общая
   * механика двух пирамид (максимумов высоты и пер-узловой ε). Раскладка
   * bbox, анврап долготы и запас в блоках описаны в докблоке
   * `buildNodeMaxHeightPyramid`; держать это в двух копиях значит уронить
   * одну из них при первой же правке развёртки.
   */
  private forEachLeafBlockBounds(
    block: number,
    blocksX: number,
    blocksY: number,
    visit: (leafIndex: number, colLo: number, colHi: number, rowLo: number, rowHi: number) => void
  ): void {
    const { width, height } = this.map

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

          visit(
            face * FACE_NODE_COUNT + leafOffset + i * leafPatches + j,
            Math.floor((uLo * width) / block) - BLOCK_PAD,
            Math.floor((uHi * width) / block) + BLOCK_PAD,
            Math.max(0, Math.floor((vLo * height) / block) - BLOCK_PAD),
            Math.min(blocksY - 1, Math.floor((vHi * height) / block) + BLOCK_PAD)
          )
        }
      }
    }
  }

  /** Подъём пирамиды узлов: родитель — максимум четверых детей, партиция точная. */
  private raiseNodePyramid(pyramid: Float32Array): void {
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
                const value = pyramid[face * FACE_NODE_COUNT + childOffset + (i * 2 + di) * childPatches + (j * 2 + dj)]
                if (value > m) m = value
              }
            }

            pyramid[face * FACE_NODE_COUNT + offset + i * patches + j] = m
          }
        }
      }
    }
  }

  /**
   * Пер-узловая ε (числитель SSE): шероховатость МЕСТА вместо одного p99 на
   * всё тело. Глобальная ε обслуживает поверхность одинаково — замер на карте
   * с переменной шероховатостью: половина узлов вдвое глаже её (равнины
   * тесселируются подробнее нужного), 9% грубее, самый грубый в 2.2 раза
   * (то есть обещание ручки sseSplitPixels на нём не выполняется).
   *
   * Лист берёт ВТОРОЙ ПО ВЕЛИЧИНЕ размах среди блоков своего bbox, а не
   * максимум (решение владельца): одиночный битый блок — артефакт DEM, шов,
   * NODATA — при свёртке максимумом поднял бы ε своего листа и всей цепочки
   * предков до корня грани. Второй по величине его не видит, пока соседние
   * блоки плоские; это тот же мотив, что у глобального p99 («одиночный обрыв
   * не задирает ε»), только локальный.
   *
   * Узел МОДУЛИРУЕТ готовый по-уровневый профиль, а не пересчитывает его:
   * ε(узел, L) = ε(L) × шероховатость_узла / глобальный_анкер. Своей копии
   * закона убывания здесь нет намеренно — по-уровневая ε меряет ℓ1/ℓ2 прямо
   * по окнам, а не выводит их законом, и копия разошлась бы с ней на картах,
   * где вершинный шаг далёк от блока (на игрушечной карте 8×4 расхождение
   * доходило до 64 раз). При шероховатости, равной анкеру, пер-узловая ε
   * тождественна по-уровневой — это и есть точка отсчёта.
   *
   * Монотонность вниз по дереву выходит по построению: шероховатость
   * родителя ≥ детской (максимум при подъёме), профиль с глубиной убывает.
   *
   * Юбки НА ЭТУ ε НЕ ПЕРЕВОДЯТСЯ: юбка закрывает недобор ГРУБОГО СОСЕДА, а
   * не свой собственный, и своя (меньшая) ε сузила бы стенку там, где сосед
   * как раз шероховатее — им остаётся глобальная `geometricErrorMeters`.
   */
  private buildNodeErrorPyramid(
    block: number,
    blockMin: Uint16Array,
    blockMax: Uint16Array,
    blocksX: number,
    blocksY: number,
    levelErrorMeters: Float64Array,
    anchorMeters: number,
    wideAnchor: boolean
  ): Float32Array {
    const pyramid = new Float32Array(CUBE_FACES * FACE_NODE_COUNT)

    /**
     * Размах окна 2×2 блока — фолбэк ровно того же случая, что у по-уровневой
     * ε: при блоке в один тексель размах ОДИНОЧНОГО блока тождественно нулевой
     * (один отсчёт), и вся пирамида выродилась бы в нули, а дерево перестало
     * бы делиться вовсе. Долгота заворачивается, широта клампится — как всюду.
     */
    const wideRange = (row: number, col: number): number => {
      let lo = 65535
      let hi = 0

      for (let dy = 0; dy <= 1; dy++) {
        const ny = Math.min(row + dy, blocksY - 1)

        for (let dx = 0; dx <= 1; dx++) {
          const b = ny * blocksX + ((col + dx) % blocksX)
          if (blockMin[b] < lo) lo = blockMin[b]
          if (blockMax[b] > hi) hi = blockMax[b]
        }
      }

      return hi - lo
    }

    this.forEachLeafBlockBounds(block, blocksX, blocksY, (leafIndex, colLo, colHi, rowLo, rowHi) => {
      let first = 0
      let second = 0

      for (let row = rowLo; row <= rowHi; row++) {
        for (let colRaw = colLo; colRaw <= colHi; colRaw++) {
          const col = ((colRaw % blocksX) + blocksX) % blocksX
          const range = wideAnchor ? wideRange(row, col) : blockMax[row * blocksX + col] - blockMin[row * blocksX + col]

          if (range > first) {
            second = first
            first = range
          } else if (range > second) {
            second = range
          }
        }
      }

      pyramid[leafIndex] = second * this.metersPerRaw
    })

    this.raiseNodePyramid(pyramid)

    // По-уровневый профиль берётся ГОТОВЫМ, узел лишь модулирует его своей
    // шероховатостью относительно глобального анкера. Пересчитывать профиль
    // заново нельзя: по-уровневая ε меряет ℓ1/ℓ2 напрямую по окнам, а не
    // выводит их законом, и своя копия закона разошлась бы с ней на картах,
    // где вершинный шаг далёк от блока. При шероховатости, равной анкеру,
    // пер-узловая ε тождественна по-уровневой — это и есть точка отсчёта.
    for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
      const scale = anchorMeters > 0 ? levelErrorMeters[level] / anchorMeters : 0
      const offset = pyramidLevelOffset(level)
      const patches = 2 ** level

      for (let face = 0; face < CUBE_FACES; face++) {
        const base = face * FACE_NODE_COUNT + offset

        for (let n = 0; n < patches * patches; n++) pyramid[base + n] *= scale
      }
    }

    return pyramid
  }

  private buildNodeMaxHeightPyramid(block: number, blockMax: Uint16Array, blocksX: number, blocksY: number): Float32Array {
    const { minMeters, maxMeters } = this.map
    const pyramid = new Float32Array(CUBE_FACES * FACE_NODE_COUNT)
    const rawToMeters = (raw: number): number => minMeters + (raw / 65535) * (maxMeters - minMeters)

    this.forEachLeafBlockBounds(block, blocksX, blocksY, (leafIndex, colLo, colHi, rowLo, rowHi) => {
      let maxRaw = 0

      for (let row = rowLo; row <= rowHi; row++) {
        for (let colRaw = colLo; colRaw <= colHi; colRaw++) {
          const col = ((colRaw % blocksX) + blocksX) % blocksX
          const value = blockMax[row * blocksX + col]
          if (value > maxRaw) maxRaw = value
        }
      }

      pyramid[leafIndex] = rawToMeters(maxRaw)
    })

    this.raiseNodePyramid(pyramid)

    return pyramid
  }


  /**
   * ε КОНКРЕТНОГО узла, метры — числитель SSE (`terrainQuadtreeSelect`).
   * Шероховатость места, а не тела целиком: см. докблок
   * `buildNodeErrorPyramid`, там же почему юбки остались на по-уровневой.
   *
   * Константное поле (пирамида `null`, вода) падает на по-уровневую: её ε
   * задаётся кривизной сферы и от узла не зависит по определению.
   *
   * Кламп уровня тот же и с той же ловушкой, что у `nodeMaxHeightMeters`:
   * `i, j` под клампнутый уровень НЕ пересчитываются, звать с уровнем вне
   * диапазона и чужими индексами нельзя.
   */
  public nodeGeometricErrorMeters(face: number, level: number, i: number, j: number): number {
    if (this.nodeErrorMetersPyramid === null) return this.geometricErrorMeters(level)

    const clampedLevel = Math.min(Math.max(level, TERRAIN_QUADTREE_MIN_LEVEL), TERRAIN_QUADTREE_MAX_LEVEL)
    const patches = 2 ** clampedLevel

    return this.nodeErrorMetersPyramid[face * FACE_NODE_COUNT + pyramidLevelOffset(clampedLevel) + i * patches + j]
  }

  /** ε уровня дерева, метры: p99 размаха высот в окне шага вершинной сетки уровня; ниже блочного разрешения — линейное масштабирование шага. Глубина юбки; для SSE — `nodeGeometricErrorMeters`. */
  public geometricErrorMeters(level: number): number {
    return this.levelErrorMeters[
      Math.min(Math.max(level, TERRAIN_QUADTREE_MIN_LEVEL), TERRAIN_QUADTREE_MAX_LEVEL)
    ]
  }

  /**
   * Честный максимум высоты узла квадродерева (face, level, i, j), метры —
   * см. докблок поля `nodeMaxHeightMetersPyramid` и билдера.
   *
   * КОНСТАНТНОЕ поле (пирамида `null`, см. докблок поля) — максимум узла
   * тождественно уровню на всей карте (`min === max === levelMeters`),
   * читать пирамиду незачем: любой честный MAX по константе равен самой
   * константе.
   *
   * ЛОВУШКА клампа: `level` вне `[MIN_LEVEL, MAX_LEVEL]` клампится, но `i, j`
   * под клампнутый уровень НЕ пересчитываются — в отличие от
   * `geometricErrorMeters` (у той индексов нет), здесь кламп корректен только
   * при согласованных (level, i, j). Все вызывающие держат level в диапазоне
   * через рекурсию отбора; звать с level вне диапазона и чужими i/j нельзя.
   */
  public nodeMaxHeightMeters(face: number, level: number, i: number, j: number): number {
    if (this.nodeMaxHeightMetersPyramid === null) return this.map.minMeters

    const clampedLevel = Math.min(Math.max(level, TERRAIN_QUADTREE_MIN_LEVEL), TERRAIN_QUADTREE_MAX_LEVEL)
    const patches = 2 ** clampedLevel

    return this.nodeMaxHeightMetersPyramid[face * FACE_NODE_COUNT + pyramidLevelOffset(clampedLevel) + i * patches + j]
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
 * Полуокно кривизнной суммы вокруг текселя, в текселях: целая часть плюс
 * дробный вес крайней пары. Хорда пролёта `s` опирается на изломы в полосе
 * ±(s−1) вокруг текселя (при s ≤ 1 — только на излом самого текселя), и
 * дробный вес нужен, чтобы окно РОСЛО НЕПРЕРЫВНО с широтой: скачок на целый
 * тексель дал бы ступеньку в оценке провиса ровно там, где её убирает вся
 * эта модель.
 */
function sagWindow(stepTexels: number, spanCap: number): { whole: number; fraction: number } {
  const half = Math.min(spanCap, Math.max(0, stepTexels - 1))
  const whole = Math.floor(half)

  return { whole, fraction: half - whole }
}

/**
 * Восток-западная компонента провиса, raw-единицы: кривизнная мажоранта
 * хорды вершинного пролёта `stepTexels` по сумме |вторых разностей| в её
 * окне (`sagWindow`).
 *
 * Вывод. Кусочно-линейная (вдоль строки) поверхность отклоняется от хорды на
 * `e(u) = Σᵢ G(u, i)·d2ᵢ`, где G — функция Грина отрезка, `G ≤ s/4`. Отсюда
 * мажоранта `(s/4)·Σ|d2ᵢ|`; множитель здесь ВДВОЕ больше — тот самый запас,
 * который узкая ветка держала под видом `0.5·|d2|`, и на пролёте ≤ 1 тексель
 * формула в неё и вырождается: окно сжато в один тексель, `max(s,1) = 1`,
 * результат — ровно `0.5·|d2ₓ|`, единица в единицу как раньше.
 *
 * Чего здесь НЕТ намеренно: размаха (max−min). Хорда следует линейному
 * тренду поверхности ТОЧНО и отклоняется только от кривизны — размах же
 * считает и наклон, который на рельефе кривизну подавляет. Прежняя модель
 * переключалась на размах при первом же превышении текселя, и оценка
 * подскакивала в разы на одной параллели (для карты 8192 — на 60°): замер
 * 25.7 м → 139.2 м, то есть пол камеры дёргался вверх на сотню метров при
 * перелёте через широту. Размах остался ПОТОЛКОМ у вызывающих: у полюса
 * пролёт доходит до сотен текселей, кривизнная сумма растёт быстрее любой
 * реальной амплитуды, и грубая мажоранта честно её страхует.
 *
 * Потолок при `stepTexels ≤ 1` не нужен и не считается: `|d2| ≤ 2·range`
 * для любых трёх отсчётов (|a−2b+c| ≤ |a−b| + |c−b|), поэтому половина
 * второй разности размах не пробивает НИКОГДА.
 */
function ewCurvatureRaw(stepTexels: number, absD2Sum: number): number {
  return 0.5 * Math.max(stepTexels, 1) * absD2Sum
}

/**
 * Сумма `length` подряд идущих элементов кольцевой строки, начиная с `from`
 * (индекс может быть отрицательным), через префиксы — O(1) на окно любой
 * ширины. Окно уже ширины строки по построению (полуокно капается на
 * `spanCap` = четверть ширины), поэтому заворот случается не более одного
 * раза и разбивается ровно на два отрезка.
 */
function circularSum(prefix: Float64Array, total: number, width: number, from: number, length: number): number {
  const start = ((from % width) + width) % width
  const end = start + length

  return end <= width ? prefix[end] - prefix[start] : total - prefix[start] + prefix[end - width]
}

/** |вторая разность| по долготе на текселе i строки row, с заворотом шва. */
function absD2At(data: Uint16Array, row: number, width: number, i: number): number {
  const x = ((i % width) + width) % width
  const lo = x === 0 ? width - 1 : x - 1
  const hi = x === width - 1 ? 0 : x + 1

  return Math.abs(data[row + lo] - 2 * data[row + x] + data[row + hi])
}

/**
 * Диапазон (max−min) по скользящему кольцевому окну ±span текселей вокруг
 * каждого x в строке row — ПОТОЛОК восток-западной оценки провиса на
 * широтах, где вершинный пролёт шире текселя (сама оценка считается по
 * кривизне, см. `ewCurvatureRaw`; хорда не может отклониться от поверхности
 * больше, чем поверхность гуляет в её окне, и у полюса этот грубый бонд
 * оказывается ниже кривизнного). O(width) через
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
