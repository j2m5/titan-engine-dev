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
 * Лоб rubble-pile (морфология B): эллипсоид со своим центром и полуосями,
 * слипающийся с другими лобами через smooth-max. Инвариант генерации:
 * |center| < min(axes) — начало координат строго внутри каждого лоба
 * (гарантия звёздности, см. lobeRadius).
 */
interface ArchetypeLobe {
  center: [number, number, number]
  axes: [number, number, number]
}

/**
 * Кратер морфологии C: центр — единичное направление на эллипсоиде;
 * angularRadius — угловой радиус кратера в единицах (1 − cos) (см. craterProfile,
 * u = (1 − dot(dir, center)) / angularRadius); depth — глубина чаши в долях
 * локального радиуса эллипсоида (мультипликативная врезка в crateredRadius).
 */
interface ArchetypeCrater {
  center: [number, number, number]
  angularRadius: number
  depth: number
}

/**
 * Морфология архетипа: A — осколок (fragment), B — слипшиеся лобы (rubble),
 * C — кратерный монолит (cratered), D — контактная двойная (binary: два лоба на
 * оси X с перемычкой, как Итокава/Аррокот), E — волчок (top: сплюснутый
 * эллипсоид с экваториальным гребнем, как Бенну/Рюгу).
 */
type ArchetypeMorphology = 'fragment' | 'rubble' | 'binary' | 'top' | 'cratered'

/**
 * Параметры архетипа-осколка (морфология A спеки): тело = эллипсоид ∩
 * пересечение полупространств (ячейка Вороного) со скруглением кромок
 * smooth-min + среднечастотный fBm. Все параметры детерминированы сидом.
 *
 * normalization: множитель нормализации до max r = 1. Ноль означает AUTO —
 * конструктор посчитает его по сетке сэмплов; любое другое значение берётся
 * как есть.
 *
 * Морфология 'rubble' строит тело из lobes и не использует planes/axes;
 * 'cratered' — эллипсоид по axes с мультипликативно врезанными craters.
 */
interface ArchetypeParams {
  /** Полуоси эллипсоида, нормированы на единичный объём (∛(x·y·z)=1); морфология A и C */
  axes: [number, number, number]
  /** 6–12 плоскостей разлома; морфология A (для rubble/cratered — []) */
  planes: ArchetypePlane[]
  /** Лобы rubble-pile; морфология B (для fragment/cratered — []) */
  lobes: ArchetypeLobe[]
  /** Кратеры, врезанные в силуэт; морфология C (для fragment/rubble — []) */
  craters: ArchetypeCrater[]
  /** Радиус скругления (морфология A: smooth-min кромок; морфология B: smooth-max слипания; не используется в C) */
  edgeRadius: number
  /** Амплитуда среднечастотного fBm (щадящая — не съедает фасеты/лобы) */
  noiseAmp: number
  /** Частота fBm в dir-домене */
  noiseFreq: number
  /** Сид шума (домен fBm) */
  seed: number
  /** Множитель нормализации (max r = 1); 0 = AUTO, другие значения = явный множитель */
  normalization: number
  /**
   * Экваториальный гребень волчка (морфология E): амплитуда в долях радиуса и
   * ширина колокола в единицах синуса широты (полярная ось — Y). У остальных
   * морфологий 0.
   */
  ridgeAmp: number
  ridgeWidth: number
  /** Морфология тела (см. ArchetypeMorphology) */
  morphology: ArchetypeMorphology
}

/** Полиномиальный smooth-min (Quilez): физически — скол кромки радиусом k */
const smin = (a: number, b: number, k: number): number => {
  if (k <= 0) return Math.min(a, b)
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1)
  return b * (1 - h) + a * h - k * h * (1 - h)
}

/** Полиномиальный smooth-max: «слипание» лобов rubble-pile (дуальность к smooth-min) */
const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k)

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
function generateFragmentParams(rng: SeededRandom): ArchetypeParams {
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
    lobes: [],
    craters: [],
    edgeRadius: rng.range(0.02, 0.08),
    noiseAmp: rng.range(0.03, 0.06),
    noiseFreq: rng.range(2.5, 4),
    seed: rng.int(1, 0x7fffffff),
    normalization: 0,
    ridgeAmp: 0,
    ridgeWidth: 0,
    morphology: 'fragment'
  }
}

/**
 * Сгенерировать параметры rubble-pile (морфология B): 3–7 слипшихся лобов.
 * Полуоси каждого лоба независимы (без нормировки объёма — форма определяется
 * их взаимным перекрытием, не единичным телом). Центр лоба — случайное
 * направление на дальность < 0.45·min(полуось лоба): это строго меньше
 * min(axes), поэтому начало координат гарантированно внутри лоба (см.
 * lobeRadius — необходимо для C < 0 и, значит, звёздности каждого лоба).
 */
function generateRubbleParams(rng: SeededRandom): ArchetypeParams {
  const lobeCount = rng.int(3, 7)
  const lobes: ArchetypeLobe[] = []
  for (let i = 0; i < lobeCount; i++) {
    const axes: [number, number, number] = [
      rng.range(0.45, 0.75),
      rng.range(0.45, 0.75),
      rng.range(0.45, 0.75)
    ]
    const minAxis = Math.min(axes[0], axes[1], axes[2])
    const maxCenterMag = 0.45 * minAxis
    const dir = randomUnit(rng)
    // rng.next() ∈ [0, 1) → магнитуда строго < maxCenterMag ≤ 0.45·min(axes)
    const mag = maxCenterMag * rng.next()
    lobes.push({
      center: [dir[0] * mag, dir[1] * mag, dir[2] * mag],
      axes
    })
  }

  return {
    // Верхнеуровневый эллипсоид морфологии A не используется телом rubble
    axes: [1, 1, 1],
    planes: [],
    lobes,
    craters: [],
    // Радиус smooth-max «слипания» лобов (переиспользует поле edgeRadius)
    edgeRadius: rng.range(0.12, 0.2),
    // Бугристость: заметнее, чем щадящий fBm морфологии A
    noiseAmp: rng.range(0.06, 0.1),
    noiseFreq: rng.range(2.5, 4),
    seed: rng.int(1, 0x7fffffff),
    normalization: 0,
    ridgeAmp: 0,
    ridgeWidth: 0,
    morphology: 'rubble'
  }
}

/**
 * Сгенерировать параметры кратерного монолита (морфология C): эллипсоид
 * (та же нормировка объёма, что у fragment — «поза» камня) с 2–5 кратерами,
 * врезанными в силуэт. Центр кратера — случайное единичное направление
 * (randomUnit). planes и
 * lobes морфологий A/B не используются (тело монолита не фасетировано и не
 * слипается из лобов) — edgeRadius по той же причине не используется телом,
 * храним 0 (skip smooth-min/max в crateredRadius для этой морфологии).
 */
function generateCrateredParams(rng: SeededRandom): ArchetypeParams {
  const raw: [number, number, number] = [
    0.7 + 0.7 * rng.next(),
    0.7 + 0.7 * rng.next(),
    0.7 + 0.7 * rng.next()
  ]
  const norm = Math.cbrt(raw[0] * raw[1] * raw[2])
  const axes: [number, number, number] = [raw[0] / norm, raw[1] / norm, raw[2] / norm]

  const craterCount = rng.int(2, 5)
  const craters: ArchetypeCrater[] = []
  for (let i = 0; i < craterCount; i++) {
    craters.push({
      center: randomUnit(rng),
      angularRadius: rng.range(0.25, 0.5),
      depth: rng.range(0.08, 0.18)
    })
  }

  return {
    axes,
    planes: [],
    lobes: [],
    craters,
    edgeRadius: 0,
    // Щадящий fBm, как у морфологии A — не забивает форму кратеров
    noiseAmp: rng.range(0.05, 0.08),
    noiseFreq: rng.range(2.5, 4),
    seed: rng.int(1, 0x7fffffff),
    normalization: 0,
    ridgeAmp: 0,
    ridgeWidth: 0,
    morphology: 'cratered'
  }
}

/**
 * Сгенерировать параметры контактной двойной (морфология D): два лоба на оси X,
 * разведённые в разные стороны — тело (+X) и меньшая голова (−X, полуоси в
 * 0.6–0.9 от тела). Центр каждого лоба на 55–80% его полуоси вдоль X: начало
 * координат остаётся внутри обоих лобов (Σ(c/axes)² < 1), поэтому объединение
 * через smooth-max звёздно, а перекрытие мало — получается перемычка, а не
 * комок rubble. Ось X условна: инстанс поворачивается случайно.
 */
function generateBinaryParams(rng: SeededRandom): ArchetypeParams {
  const bodyAxes: [number, number, number] = [rng.range(0.6, 0.8), rng.range(0.45, 0.65), rng.range(0.45, 0.65)]
  const ratio = rng.range(0.6, 0.9)
  const headAxes: [number, number, number] = [bodyAxes[0] * ratio, bodyAxes[1] * ratio, bodyAxes[2] * ratio]
  const bodyOffset = bodyAxes[0] * rng.range(0.55, 0.8)
  const headOffset = headAxes[0] * rng.range(0.55, 0.8)

  return {
    axes: [1, 1, 1],
    planes: [],
    lobes: [
      { center: [bodyOffset, 0, 0], axes: bodyAxes },
      { center: [-headOffset, 0, 0], axes: headAxes }
    ],
    craters: [],
    // Радиус smooth-max перемычки
    edgeRadius: rng.range(0.1, 0.18),
    noiseAmp: rng.range(0.04, 0.08),
    noiseFreq: rng.range(2.5, 4),
    seed: rng.int(1, 0x7fffffff),
    normalization: 0,
    ridgeAmp: 0,
    ridgeWidth: 0,
    morphology: 'binary'
  }
}

/**
 * Сгенерировать параметры волчка (морфология E): сплюснутый эллипсоид с
 * полярной осью Y (экваториальные полуоси равны, полярная меньше) и
 * экваториальным гребнем — колокол по синусу широты, амплитуда 6–14% радиуса.
 * Быстровращающиеся rubble pile (Бенну, Рюгу, Дидим) имеют именно такой
 * ромбический профиль.
 */
function generateTopParams(rng: SeededRandom): ArchetypeParams {
  const equatorial = rng.range(1.0, 1.12)
  const polar = rng.range(0.72, 0.9)

  return {
    axes: [equatorial, polar, equatorial],
    planes: [],
    lobes: [],
    craters: [],
    edgeRadius: 0,
    noiseAmp: rng.range(0.03, 0.05),
    noiseFreq: rng.range(2.5, 4),
    seed: rng.int(1, 0x7fffffff),
    normalization: 0,
    ridgeAmp: rng.range(0.06, 0.14),
    ridgeWidth: rng.range(0.15, 0.3),
    morphology: 'top'
  }
}

/**
 * Сгенерировать параметры архетипа для заданной морфологии (по умолчанию —
 * 'fragment', обратная совместимость со старыми вызовами без второго
 * аргумента).
 */
function generateArchetypeParams(
  rng: SeededRandom,
  morphology: ArchetypeMorphology = 'fragment'
): ArchetypeParams {
  switch (morphology) {
    case 'cratered':
      return generateCrateredParams(rng)
    case 'rubble':
      return generateRubbleParams(rng)
    case 'binary':
      return generateBinaryParams(rng)
    case 'top':
      return generateTopParams(rng)
    default:
      return generateFragmentParams(rng)
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
        const r = this.rawSurface(s * Math.cos(a), y, s * Math.sin(a)).r
        if (r > max) max = r
      }
      this.params.normalization = max > 0 ? 1 / max : 1
    }
  }

  /**
   * Радиус + сигналы поверхности до нормализации: ветвление по морфологии.
   * freshness несёт только fragment, cavity — только cratered (rubble → оба 0).
   */
  private rawSurface(dx: number, dy: number, dz: number): { r: number; freshness: number; cavity: number } {
    switch (this.params.morphology) {
      case 'rubble':
      case 'binary':
        // Двойная — те же слипшиеся лобы, разведённые генератором параметров
        return { r: this.rubbleRadius(dx, dy, dz), freshness: 0, cavity: 0 }
      case 'top':
        return { r: this.topRadius(dx, dy, dz), freshness: 0, cavity: 0 }
      case 'cratered': {
        const { r, cavity } = this.crateredRadius(dx, dy, dz)
        return { r, freshness: 0, cavity }
      }
      case 'fragment':
      default: {
        const { r, freshness } = this.fragmentRadius(dx, dy, dz)
        return { r, freshness, cavity: 0 }
      }
    }
  }

  /**
   * Радиус осколка (морфология A) до нормализации + freshness — доля "победы"
   * плоскости разлома над эллипсоидом в smooth-min (см. surfaceAt в публичном
   * API). rEll и минимальный rPlane сравниваются ДО smin-сглаживания —
   * freshness читает геометрический запас победы, а не сглаженное значение r.
   */
  private fragmentRadius(dx: number, dy: number, dz: number): { r: number; freshness: number } {
    const { axes, planes, edgeRadius, noiseAmp, noiseFreq, seed } = this.params

    // Эллипсоид в радиальной форме: r = 1 / |dir / axes|
    const ex = dx / axes[0]
    const ey = dy / axes[1]
    const ez = dz / axes[2]
    const rEll = 1 / Math.sqrt(ex * ex + ey * ey + ez * ez)
    let r = rEll

    // Ячейка Вороного: smooth-min по плоскостям, смотрящим в сторону dir.
    // Раковистый излом: купол w = dot² максимален напротив центра фасеты —
    // вогнутость/выпуклость ±dish, чтобы грань не была идеально плоской.
    let rPlaneMin = Infinity
    let anyPlane = false
    for (const plane of planes) {
      const dot = dx * plane.normal[0] + dy * plane.normal[1] + dz * plane.normal[2]
      if (dot <= 1e-6) continue
      const w = dot * dot
      const rPlane = (plane.distance * (1 - plane.dish * w)) / dot
      r = smin(r, rPlane, edgeRadius)
      if (rPlane < rPlaneMin) rPlaneMin = rPlane
      anyPlane = true
    }

    // freshness: 1, когда плоскость выигрывает smooth-min с запасом ≥ edgeRadius
    // (margin = rEll - rPlaneMin), 0 — когда побеждает эллипсоид (нет плоскости
    // в этом направлении или она проигрывает), линейный переход в полосе
    // ±edgeRadius вокруг margin=0 (та же геометрия перехода, что у smin/h).
    let freshness = 0
    if (anyPlane) {
      const margin = rEll - rPlaneMin
      if (edgeRadius <= 0) {
        freshness = margin >= 0 ? 1 : 0
      } else {
        freshness = Math.min(Math.max(0.5 + (0.5 * margin) / edgeRadius, 0), 1)
      }
    }

    // Среднечастотный fBm: мягкие лямпы поверх (амплитуда щадящая — фасеты живы)
    if (noiseAmp > 0) {
      const f = fbm3({ x: dx * noiseFreq, y: dy * noiseFreq, z: dz * noiseFreq }, seed, 2, 2, 0.5)
      r *= 1 + noiseAmp * f
    }

    return { r, freshness }
  }

  /**
   * Дальний корень |(t·d − c)/a|² = 1; начало гарантированно внутри (C < 0)
   */
  private lobeRadius(dx: number, dy: number, dz: number, lobe: ArchetypeLobe): number {
    const ex = dx / lobe.axes[0], ey = dy / lobe.axes[1], ez = dz / lobe.axes[2]
    const cx = lobe.center[0] / lobe.axes[0], cy = lobe.center[1] / lobe.axes[1], cz = lobe.center[2] / lobe.axes[2]
    const A = ex * ex + ey * ey + ez * ez
    const B = -2 * (ex * cx + ey * cy + ez * cz)
    const C = cx * cx + cy * cy + cz * cz - 1
    // C < 0 по построению параметров → дискриминант > 0, дальний корень > 0
    return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A)
  }

  /** Радиус rubble-pile (морфология B) до нормализации: smooth-max по лобам + fBm бугристость */
  private rubbleRadius(dx: number, dy: number, dz: number): number {
    const { lobes, edgeRadius, noiseAmp, noiseFreq, seed } = this.params

    // Слипание лобов: smooth-max — тело растёт «наружу» по каждому лобу,
    // а не пересекается (в отличие от smooth-min кромок морфологии A).
    let r = this.lobeRadius(dx, dy, dz, lobes[0])
    for (let i = 1; i < lobes.length; i++) {
      r = smax(r, this.lobeRadius(dx, dy, dz, lobes[i]), edgeRadius)
    }

    // Бугристость поверх слипшихся лобов (тот же fBm-домен, что у морфологии A)
    if (noiseAmp > 0) {
      const f = fbm3({ x: dx * noiseFreq, y: dy * noiseFreq, z: dz * noiseFreq }, seed, 2, 2, 0.5)
      r *= 1 + noiseAmp * f
    }

    return r
  }

  /**
   * Радиус волчка (морфология E) до нормализации: сплюснутый эллипсоид ×
   * (1 + ridgeAmp · exp(−(sin широты / ridgeWidth)²)) — экваториальный гребень
   * (полярная ось Y, sin широты = dy), плюс щадящий fBm.
   */
  private topRadius(dx: number, dy: number, dz: number): number {
    const { axes, ridgeAmp, ridgeWidth, noiseAmp, noiseFreq, seed } = this.params

    const ex = dx / axes[0]
    const ey = dy / axes[1]
    const ez = dz / axes[2]
    let r = 1 / Math.sqrt(ex * ex + ey * ey + ez * ez)

    if (ridgeAmp > 0 && ridgeWidth > 0) {
      const u = dy / ridgeWidth
      r *= 1 + ridgeAmp * Math.exp(-u * u)
    }

    if (noiseAmp > 0) {
      const f = fbm3({ x: dx * noiseFreq, y: dy * noiseFreq, z: dz * noiseFreq }, seed, 2, 2, 0.5)
      r *= 1 + noiseAmp * f
    }

    return r
  }

  /**
   * Профиль кратера по нормированному угловому расстоянию u ∈ [0, 1] от центра
   * (формула отработана в surface-v1 — процедурный облик L0 астероидов):
   * bowl — параболическая чаша (отрицательна, максимум просадки в центре u=0);
   * rim — гауссов вал вокруг u=0.9 (положителен — приподнятая кромка кратера);
   * window — smoothstep-окно, гладко гасящее профиль к краю u∈[0.9, 1], чтобы
   * не было разрыва производной на границе кратера.
   */
  private craterProfile(u: number): number {
    if (u >= 1) return 0
    const bowl = (u * u - 1) * 0.6
    const rim = Math.exp(-40 * (u - 0.9) * (u - 0.9)) * 0.5
    const t = Math.min(Math.max((u - 0.9) / 0.1, 0), 1)
    const window = 1 - t * t * (3 - 2 * t)
    return (bowl + rim) * window
  }

  /**
   * Радиус кратерного монолита до нормализации: эллипсоид с мультипликативной
   * врезкой кратеров r = rEll · (1 + Σ depth·profile(u)), где u — угловое
   * расстояние до центра кратера в долях его angularRadius. Мультипликативно,
   * чтобы вал не ломал нормализацию.
   *
   * cavity — нормированная глубина чаши, только отрицательная часть dent, из
   * той же суммы (вал в неё не входит).
   */
  private crateredRadius(dx: number, dy: number, dz: number): { r: number; cavity: number } {
    const { axes, craters, noiseAmp, noiseFreq, seed } = this.params

    const ex = dx / axes[0]
    const ey = dy / axes[1]
    const ez = dz / axes[2]
    let r = 1 / Math.sqrt(ex * ex + ey * ey + ez * ez)

    let dent = 0
    for (const crater of craters) {
      const dot = dx * crater.center[0] + dy * crater.center[1] + dz * crater.center[2]
      const u = (1 - dot) / crater.angularRadius
      dent += crater.depth * this.craterProfile(u)
    }
    r *= 1 + dent

    const cavity = Math.min(1, Math.max(0, -dent) / 0.12)

    // Щадящий fBm поверх врезанных кратеров (тот же домен, что у морфологий A/B)
    if (noiseAmp > 0) {
      const f = fbm3({ x: dx * noiseFreq, y: dy * noiseFreq, z: dz * noiseFreq }, seed, 2, 2, 0.5)
      r *= 1 + noiseAmp * f
    }

    return { r, cavity }
  }

  /**
   * Радиус + сигналы поверхности по нормированному направлению (максимум r по
   * сфере ≈ 1): freshness — только fragment, cavity — только cratered (см.
   * rawSurface); нормализация применяется только к r, freshness/cavity — уже
   * нормированные к [0,1] величины и масштабом тела не затрагиваются.
   */
  public surfaceAt(dx: number, dy: number, dz: number): { r: number; freshness: number; cavity: number } {
    const raw = this.rawSurface(dx, dy, dz)
    return { r: raw.r * this.params.normalization, freshness: raw.freshness, cavity: raw.cavity }
  }

  /** Радиус по нормированному направлению; максимум по сфере ≈ 1 */
  public radiusAt(dx: number, dy: number, dz: number): number {
    return this.surfaceAt(dx, dy, dz).r
  }
}

export { ArchetypeShape, generateArchetypeParams }
export type { ArchetypeParams, ArchetypePlane, ArchetypeLobe, ArchetypeCrater, ArchetypeMorphology }
