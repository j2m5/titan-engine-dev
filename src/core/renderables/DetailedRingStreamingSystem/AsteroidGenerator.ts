import { SeededRandom } from './SeededRandom'
import type { SectorBounds } from './SectorGrid'
import { RadialDensityProfile } from './RadialDensityProfile'

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
   * @param seed — детерминированный seed сектора
   * @param count — количество экземпляров для генерации
   * @param bounds — границы сектора в полярных координатах
   * @returns Float32Array длиной count * 16
   */
  public generateMatrices(seed: number, count: number, bounds: SectorBounds): Float32Array {
    const rng = new SeededRandom(seed)
    const data = new Float32Array(count * 16)
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

      // Compose матрицы inline (избегаем создание Three.js объектов для скорости)
      this.composeMatrix(data, i * 16, x, y, z, rx, ry, rz, s)
    }

    return data
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

export { AsteroidGenerator }
export type { GeneratorConfig }
