import { SeededRandom } from '../SeededRandom'
import { fbm3 } from '@/core/renderables/Nebula/fields/valueNoise'

/**
 * Плоскость разлома осколка: полупространство dot(p, normal) <= distance.
 * dish — «раковистый излом»: вогнутость (dish > 0) или выпуклость (dish < 0)
 * фасеты в долях distance; идеально плоская грань выдаёт процедурность.
 */
interface ArchetypePlane {
  normal: [number, number, number]
  distance: number
  dish: number
}

/**
 * Параметры архетипа-осколка (морфология A спеки): тело = эллипсоид ∩
 * пересечение полупространств (ячейка Вороного) со скруглением кромок
 * smooth-min + среднечастотный fBm. Все параметры детерминированы сидом.
 *
 * normalization: множитель нормализации (max r = 1); семантика —
 * 0 = AUTO, конструктор посчитает множитель по сетке сэмплов (Фибоначчи 512);
 * другие значения = явный множитель, используется как есть (для отключения
 * нормализации в тестах геометрии, например в тесте «чистый срез»).
 */
interface ArchetypeParams {
  /** Полуоси эллипсоида, нормированы на единичный объём (∛(x·y·z)=1) */
  axes: [number, number, number]
  /** 6–12 плоскостей разлома */
  planes: ArchetypePlane[]
  /** Радиус скругления кромок (smooth-min k): «свежесть» скола */
  edgeRadius: number
  /** Амплитуда среднечастотного fBm (щадящая — не съедает фасеты) */
  noiseAmp: number
  /** Частота fBm в dir-домене */
  noiseFreq: number
  /** Сид шума (домен fBm) */
  seed: number
  /** Множитель нормализации (max r = 1); 0 = AUTO, другие значения = явный множитель */
  normalization: number
}

/** Полиномиальный smooth-min (Quilez): физически — скол кромки радиусом k */
const smin = (a: number, b: number, k: number): number => {
  if (k <= 0) return Math.min(a, b)
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1)
  return b * (1 - h) + a * h - k * h * (1 - h)
}

/** Случайное направление, равномерное по сфере */
const randomUnit = (rng: SeededRandom): [number, number, number] => {
  const z = rng.range(-1, 1)
  const phi = rng.range(0, Math.PI * 2)
  const s = Math.sqrt(Math.max(1 - z * z, 0))
  return [s * Math.cos(phi), s * Math.sin(phi), z]
}

/**
 * Сгенерировать параметры осколка (морфология A). Диапазоны — из спеки §1–2;
 * тратит фиксированное число вызовов rng только через собственный экземпляр
 * SeededRandom → детерминизм не зависит от порядка вызовов извне.
 */
function generateArchetypeParams(rng: SeededRandom): ArchetypeParams {
  // Оси: [0.7, 1.4] с нормировкой объёма — «поза» камня (как в бывшем GPU-чанке)
  const raw: [number, number, number] = [
    0.7 + 0.7 * rng.next(),
    0.7 + 0.7 * rng.next(),
    0.7 + 0.7 * rng.next()
  ]
  const norm = Math.cbrt(raw[0] * raw[1] * raw[2])
  const axes: [number, number, number] = [raw[0] / norm, raw[1] / norm, raw[2] / norm]

  const planeCount = rng.int(6, 12)
  const planes: ArchetypePlane[] = []
  for (let i = 0; i < planeCount; i++) {
    planes.push({
      normal: randomUnit(rng),
      // Глубина среза: < max полуоси (реально режет), > 0.55 (не съедает тело)
      distance: rng.range(0.55, 0.9),
      // Раковистый излом ±2–4%: половина фасет чуть вогнутые, половина выпуклые
      dish: rng.range(-0.04, 0.04)
    })
  }

  return {
    axes,
    planes,
    edgeRadius: rng.range(0.02, 0.08),
    noiseAmp: rng.range(0.03, 0.06),
    noiseFreq: rng.range(2.5, 4),
    seed: rng.int(1, 0x7fffffff),
    normalization: 0
  }
}

/**
 * Радиальная функция осколка r(направление) ∈ (0, 1] (спека §2).
 * Звёздность по построению: все полупространства содержат начало (distance>0),
 * эллипсоид звёздный, fBm — мультипликативная рябь малой амплитуды.
 * Нормализация max=1 выполняется в конструкторе по спирали Фибоначчи 512 направлений
 * (та же сетка, что в тестах и запекании, — max действительно достигается).
 */
class ArchetypeShape {
  private readonly params: ArchetypeParams

  public constructor(params: ArchetypeParams) {
    this.params = { ...params }
    if (params.normalization === 0) {
      // Проход нормализации: сэмплы по спирали Фибоначчи 512 направлений
      // (та же сетка что в тестах и запекании — max действительно достигается)
      let max = 0
      const n = 512
      const golden = Math.PI * (3 - Math.sqrt(5))
      for (let i = 0; i < n; i++) {
        const y = 1 - (2 * (i + 0.5)) / n
        const s = Math.sqrt(Math.max(1 - y * y, 0))
        const a = golden * i
        const r = this.rawRadius(s * Math.cos(a), y, s * Math.sin(a))
        if (r > max) max = r
      }
      this.params.normalization = max > 0 ? 1 / max : 1
    }
  }

  /** Радиус до нормализации */
  private rawRadius(dx: number, dy: number, dz: number): number {
    const { axes, planes, edgeRadius, noiseAmp, noiseFreq, seed } = this.params

    // Эллипсоид в радиальной форме: r = 1 / |dir / axes|
    const ex = dx / axes[0]
    const ey = dy / axes[1]
    const ez = dz / axes[2]
    let r = 1 / Math.sqrt(ex * ex + ey * ey + ez * ez)

    // Ячейка Вороного: smooth-min по плоскостям, смотрящим в сторону dir.
    // Раковистый излом: купол w = dot² максимален напротив центра фасеты —
    // вогнутость/выпуклость ±dish, чтобы грань не была идеально плоской.
    for (const plane of planes) {
      const dot = dx * plane.normal[0] + dy * plane.normal[1] + dz * plane.normal[2]
      if (dot <= 1e-6) continue
      const w = dot * dot
      const rPlane = (plane.distance * (1 - plane.dish * w)) / dot
      r = smin(r, rPlane, edgeRadius)
    }

    // Среднечастотный fBm: мягкие лямпы поверх (амплитуда щадящая — фасеты живы)
    if (noiseAmp > 0) {
      const f = fbm3({ x: dx * noiseFreq, y: dy * noiseFreq, z: dz * noiseFreq }, seed, 2, 2, 0.5)
      r *= 1 + noiseAmp * f
    }

    return r
  }

  /** Радиус по нормированному направлению; максимум по сфере ≈ 1 */
  public radiusAt(dx: number, dy: number, dz: number): number {
    return this.rawRadius(dx, dy, dz) * this.params.normalization
  }
}

export { ArchetypeShape, generateArchetypeParams }
export type { ArchetypeParams, ArchetypePlane }
