import { SeededRandom, hashSectorKey } from './SeededRandom'
import type { SectorBounds } from './SectorGrid'
import { RadialDensityProfile } from './RadialDensityProfile'

/**
 * Финализирующая лавинная перемешка (fmix32 из MurmurHash3) поверх hashSectorKey.
 *
 * ЗАЧЕМ: сырой hashSectorKey % K даёт систематическое смещение до ~35% при K,
 * не являющемся степенью двойки (типичный случай — K=14 архетипов библиотеки:
 * 14 = 2×7). Замерено на 8000 инстансах по десятку сидов — отклонение
 * стабильно (не только для «неудачного» сида) вылезает за допуск ±30% из
 * спеки. Причина: младшие биты FNV-подобного hashSectorKey хорошо перемешаны
 * только по модулю степени двойки, но не по модулю 7/14. fmix32 добавляет ещё
 * один раунд xor-shift + умножения ИСКЛЮЧИТЕЛЬНО над уже готовым 32-битным
 * значением — источник детерминизма (hashSectorKey(seed, index, const)) не
 * меняется, rng-поток не трогается, меняется только качество распределения
 * остатка по archetypeCount.
 */
function fmix32(hIn: number): number {
  let h = hIn
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * Номер архетипа для инстанса камня (детерминированная раскладка по K архетипам).
 *
 * ПОЧЕМУ хеш, а не rng-поток: номер архетипа не должен потреблять байты из
 * SeededRandom-потока генерации позиции/поворота/масштаба — иначе смена
 * archetypeCount (K) сдвигала бы весь rng-поток и меняла позиции всех камней
 * сектора. Хеш детерминирован по (seed, index) независимо от K и от порядка
 * вызовов rng, поэтому позиции камней стабильны при перетюнинге библиотеки
 * архетипов.
 */
function archetypeForInstance(seed: number, index: number, archetypeCount: number): number {
  return fmix32(hashSectorKey(seed, index, 0x9e37)) % archetypeCount
}

/**
 * Конфигурация генератора
 */
interface GeneratorConfig {
  /** Толщина кольца (вертикальный разброс по Y в local space) */
  thickness: number
  /** Минимальный масштаб экземпляра */
  minScale: number
  /** Максимальный масштаб экземпляра */
  maxScale: number
}

/**
 * AsteroidGenerator — детерминированная процедурная генерация данных экземпляров.
 *
 * Для заданного seed и границ сектора генерирует массив 4×4 матриц трансформации.
 * Один и тот же seed + bounds + count всегда даёт одинаковый результат.
 *
 * Не создаёт Three.js объекты — только заполняет Float32Array.
 */
class AsteroidGenerator {
  private readonly config: GeneratorConfig

  /**
   * Радиальный профиль плотности (A-full importance sampling). null → радиус
   * равномерно по площади полосы. Ставится асинхронно (текстура кольца готова).
   */
  private densityProfile: RadialDensityProfile | null = null

  public constructor(config: GeneratorConfig) {
    this.config = config
  }

  /** Задать радиальный профиль: радиус камня семплится ∝ альфе (концентрация в колечках). */
  public setDensityProfile(profile: RadialDensityProfile | null): void {
    this.densityProfile = profile
  }

  /**
   * Генерирует упакованный массив матриц 4×4 (16 float на экземпляр).
   * Позиции задаются в полярных координатах внутри bounds, затем конвертируются в декартовы.
   * Результат в local space кольца (XZ-плоскость, Y — вертикальный разброс).
   *
   * Частный случай generateMatricesGrouped с одной группой (archetypeCount=1) —
   * поведение и rng-поток побитово идентичны прежней реализации.
   *
   * @param seed — детерминированный seed сектора
   * @param count — количество экземпляров для генерации
   * @param bounds — границы сектора в полярных координатах
   * @returns Float32Array длиной count * 16
   */
  public generateMatrices(seed: number, count: number, bounds: SectorBounds): Float32Array {
    return this.generateMatricesGrouped(seed, count, bounds, 1)[0]
  }

  /**
   * Генерирует матрицы инстансов и группирует их по номеру архетипа.
   *
   * Два прохода:
   * 1) только хеш archetypeForInstance (БЕЗ обращения к rng) — считаем размер
   *    каждой группы и выделяем под неё Float32Array нужной длины;
   * 2) точно текущий цикл генерации 2a (тот же rng-поток байт-в-байт, что и
   *    раньше в generateMatrices) — каждая матрица пишется в буфер своей
   *    группы по бегущему офсету этой группы.
   *
   * Раскладка по архетипам не влияет на позиции/повороты/масштабы камней —
   * это гарантируется тем, что archetypeForInstance не потребляет rng (см.
   * комментарий над функцией).
   *
   * @param seed — детерминированный seed сектора
   * @param count — количество экземпляров для генерации
   * @param bounds — границы сектора в полярных координатах
   * @param archetypeCount — число архетипов K, на которые раскладываются камни
   * @returns массив длиной archetypeCount; элемент k — Float32Array матриц камней архетипа k,
   *   в порядке возрастания исходного индекса инстанса i
   */
  public generateMatricesGrouped(
    seed: number,
    count: number,
    bounds: SectorBounds,
    archetypeCount: number
  ): Float32Array[] {
    // Проход 1: только счётчики групп — rng здесь не создаётся и не используется.
    const groupCounts = new Array<number>(archetypeCount).fill(0)
    const archetypeOf = new Int32Array(count)
    for (let i = 0; i < count; i++) {
      const k = archetypeForInstance(seed, i, archetypeCount)
      archetypeOf[i] = k
      groupCounts[k]++
    }

    const groups: Float32Array[] = groupCounts.map((c) => new Float32Array(c * 16))
    const runningOffsets = new Array<number>(archetypeCount).fill(0)

    // Проход 2: ровно прежний цикл генерации — rng-поток не сдвинут ни на байт.
    const rng = new SeededRandom(seed)
    const { thickness, minScale, maxScale } = this.config

    const r1Sq = bounds.minRadius * bounds.minRadius
    const r2Sq = bounds.maxRadius * bounds.maxRadius
    const halfThickness = thickness * 0.5

    for (let i = 0; i < count; i++) {
      // Позиция по радиусу: с профилем — importance sampling ∝ альфе (камни
      // концентрируются в колечках), иначе — равномерно по площади полосы.
      // Оба пути тратят ровно один rng.next() → детерминизм не сдвигается.
      const r = this.densityProfile
        ? this.densityProfile.sampleRadius(bounds.minRadius, bounds.maxRadius, rng.next())
        : Math.sqrt(rng.range(r1Sq, r2Sq))
      const theta = rng.range(bounds.minAngle, bounds.maxAngle)
      const x = Math.cos(theta) * r
      const z = Math.sin(theta) * r
      // Вертикаль: треугольное распределение (сумма двух uniform) — пик в средней
      // плоскости, линейный спад к краям. Равномерный слэб на высокой плотности
      // рисовал «стенку» с плоскими гранями сверху/снизу; мягкий спад её гасит.
      const y = (rng.next() + rng.next() - 1) * halfThickness

      // Поворот: случайные углы Эйлера
      const rx = rng.next() * Math.PI * 2
      const ry = rng.next() * Math.PI * 2
      const rz = rng.next() * Math.PI * 2

      // Масштаб: квадратичное распределение — больше мелких
      const t = rng.next() * rng.next()
      const s = minScale + t * (maxScale - minScale)

      // Compose матрицы inline (избегаем создание Three.js объектов для скорости),
      // запись в буфер своей группы по бегущему офсету.
      const k = archetypeOf[i]
      const offset = runningOffsets[k]
      runningOffsets[k] = offset + 16
      this.composeMatrix(groups[k], offset, x, y, z, rx, ry, rz, s)
    }

    return groups
  }

  /**
   * Записывает матрицу compose(position, eulerRotation, uniformScale) в Float32Array.
   * Вычисление rotation matrix из Euler angles (XYZ order) inline.
   * Column-major order (как Three.js Matrix4).
   */
  private composeMatrix(
    out: Float32Array,
    offset: number,
    px: number,
    py: number,
    pz: number,
    rx: number,
    ry: number,
    rz: number,
    scale: number
  ): void {
    const cx = Math.cos(rx),
      sx = Math.sin(rx)
    const cy = Math.cos(ry),
      sy = Math.sin(ry)
    const cz = Math.cos(rz),
      sz = Math.sin(rz)

    out[offset] = cy * cz * scale
    out[offset + 1] = cy * sz * scale
    out[offset + 2] = -sy * scale
    out[offset + 3] = 0

    out[offset + 4] = (sx * sy * cz - cx * sz) * scale
    out[offset + 5] = (sx * sy * sz + cx * cz) * scale
    out[offset + 6] = sx * cy * scale
    out[offset + 7] = 0

    out[offset + 8] = (cx * sy * cz + sx * sz) * scale
    out[offset + 9] = (cx * sy * sz - sx * cz) * scale
    out[offset + 10] = cx * cy * scale
    out[offset + 11] = 0

    out[offset + 12] = px
    out[offset + 13] = py
    out[offset + 14] = pz
    out[offset + 15] = 1
  }
}

export { AsteroidGenerator, archetypeForInstance }
export type { GeneratorConfig }
