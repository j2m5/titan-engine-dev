import { BufferGeometry } from 'three'
import { ASTEROID_PROFILES, type AsteroidProfileName } from '../AsteroidProfiles'
import { SeededRandom, hashSectorKey } from '../SeededRandom'
import { ArchetypeShape, generateArchetypeParams, type ArchetypeMorphology } from './ArchetypeShape'
import { buildArchetypeGeometry } from './ArchetypeGeometry'

/**
 * Порядок процедурных категорий в библиотеке: индексы каждой морфологии
 * контигуальны и идут в этом порядке. fragment первым — k=0 всегда осколок
 * (преемственность кэша). Реальные модели занимают ХВОСТ библиотеки после них
 * (категория 'real', см. archetypeLayout).
 */
const MORPHOLOGY_ORDER: readonly ArchetypeMorphology[] = ['fragment', 'rubble', 'binary', 'top', 'cratered']

/** Категория слота библиотеки: процедурная морфология либо реальная модель формы */
type LibraryCategory = ArchetypeMorphology | 'real'

/** Настройка реальной части библиотеки (по умолчанию — из профиля) */
interface RealModelsOverride {
  shapeModels: readonly string[]
  realShare: number
}

/** Раскладка библиотеки: сколько слотов процедурных и какие реальные модели в хвосте */
interface ArchetypeLayout {
  proceduralCount: number
  /** Имена моделей по слотам хвоста (список профиля по кругу) */
  realModels: string[]
}

/**
 * Раскладка библиотеки из `count` слотов: хвост под реальные модели —
 * round(count · realShare), но не больше count − 1 (k=0 всегда процедурный
 * осколок) и только при непустом списке; список профиля идёт по кругу, если
 * слотов больше моделей.
 */
function archetypeLayout(profile: AsteroidProfileName, count: number, override?: RealModelsOverride): ArchetypeLayout {
  const source = override ?? ASTEROID_PROFILES[profile]
  const names = source.shapeModels
  const share = source.realShare
  if (names.length === 0 || share <= 0 || count <= 1) return { proceduralCount: count, realModels: [] }

  const realCount = Math.min(count - 1, Math.max(0, Math.round(count * share)))
  const realModels: string[] = []
  for (let i = 0; i < realCount; i++) realModels.push(names[i % names.length])
  return { proceduralCount: count - realCount, realModels }
}

/**
 * Число архетипов каждой морфологии в библиотеке из `count` штук: пороговое
 * разбиение по кумулятивным весам профиля в порядке MORPHOLOGY_ORDER
 * (end_j = round(count · Σ_{i≤j} w_i), count_j = end_j − end_{j−1}). Когда
 * count не меньше числа категорий с ненулевым весом, округление не имеет права
 * выродить такую категорию в 0 — у неё отбирается один индекс у категории с
 * наибольшим текущим избытком (детерминированно: перебор в порядке
 * MORPHOLOGY_ORDER, наибольший донор побеждает).
 */
function morphologyCounts(profile: AsteroidProfileName, count: number): Record<ArchetypeMorphology, number> {
  const w = ASTEROID_PROFILES[profile].morphologyWeights
  const weights = MORPHOLOGY_ORDER.map((m) => w[m])

  const counts: number[] = []
  let cumulative = 0
  let prevEnd = 0
  for (let j = 0; j < weights.length; j++) {
    cumulative += weights[j]
    const end = j === weights.length - 1 ? count : Math.round(count * cumulative)
    counts.push(end - prevEnd)
    prevEnd = end
  }

  const mins: number[] = weights.map((v) => (v > 0 ? 1 : 0))
  const nonZero = mins.reduce((s: number, v: number) => s + v, 0)
  if (count >= nonZero) {
    for (let i = 0; i < counts.length; i++) {
      while (counts[i] < mins[i]) {
        let donor = -1
        for (let j = 0; j < counts.length; j++) {
          if (j === i) continue
          if (counts[j] > mins[j] && (donor === -1 || counts[j] > counts[donor])) donor = j
        }
        if (donor === -1) break
        counts[donor]--
        counts[i]++
      }
    }
  }

  // Преемственность кэша: k=0 всегда осколок. Округление может отдать
  // единственный индекс другой категории (carbonaceous, count=1: round(0.4)=0) —
  // тогда индекс забирается у самой крупной категории
  if (count > 0 && counts[0] === 0) {
    let donor = 1
    for (let j = 2; j < counts.length; j++) if (counts[j] > counts[donor]) donor = j
    counts[donor]--
    counts[0]++
  }

  const result = {} as Record<ArchetypeMorphology, number>
  MORPHOLOGY_ORDER.forEach((m, i) => (result[m] = counts[i]))
  return result
}

/** Диапазон индексов библиотеки одной категории (start, count); count может быть 0 */
interface MorphologyRange {
  morphology: LibraryCategory
  start: number
  count: number
}

/**
 * Диапазоны индексов библиотеки: процедурные категории в порядке
 * MORPHOLOGY_ORDER по голове (размером proceduralCount), затем хвост 'real' —
 * для раскладки инстансов по размеру (см. AsteroidGenerator.pickArchetype).
 */
function morphologyRanges(profile: AsteroidProfileName, count: number, override?: RealModelsOverride): MorphologyRange[] {
  const layout = archetypeLayout(profile, count, override)
  const counts = morphologyCounts(profile, layout.proceduralCount)
  const ranges: MorphologyRange[] = []
  let start = 0
  for (const morphology of MORPHOLOGY_ORDER) {
    ranges.push({ morphology, start, count: counts[morphology] })
    start += counts[morphology]
  }
  ranges.push({ morphology: 'real', start, count: layout.realModels.length })
  return ranges
}

/**
 * Категория k-го слота библиотеки из `count` штук профиля `profile` (чистая
 * функция — тестируется отдельно от кэша геометрий). Преемственность: k=0
 * всегда 'fragment'; хвост — 'real'.
 */
function morphologyForIndex(profile: AsteroidProfileName, k: number, count: number, override?: RealModelsOverride): LibraryCategory {
  for (const range of morphologyRanges(profile, count, override)) {
    if (k < range.start + range.count) return range.morphology
  }
  return 'real'
}

/**
 * Библиотека запечённых архетипов: K форм на профиль. Кэш модульный —
 * кольца одного профиля/конфигурации делят геометрии (single source
 * VBO, память не растёт с числом колец). Сид k-го архетипа независим от
 * count → усечение/расширение библиотеки не «пере жёвывает» формы (но
 * морфология k-го архетипа зависит от count — см. morphologyForIndex).
 */
const cache = new Map<string, BufferGeometry[]>()

function getArchetypeGeometries(
  profile: AsteroidProfileName,
  count: number,
  detail: number,
  radius: number
): BufferGeometry[] {
  const key = `${profile}|${count}|${detail}|${radius}`
  const cached = cache.get(key)
  if (cached) return cached

  const profileIndex = Object.keys(ASTEROID_PROFILES).indexOf(profile)
  const geometries: BufferGeometry[] = []
  for (let k = 0; k < count; k++) {
    // Сид согласован с 2a: k=0 воспроизводит прежний единственный архетип.
    // Слот реальной модели получает процедурную ЗАГЛУШКУ-осколок: пул строится
    // сразу, а геометрия стрима подменяется по приходу бинарника
    // (AsteroidRingSystem → InstancePool.replaceArchetypeGeometry)
    const category = morphologyForIndex(profile, k, count)
    const morphology: ArchetypeMorphology = category === 'real' ? 'fragment' : category
    const rng = new SeededRandom(hashSectorKey(0xa57, k, profileIndex))
    const shape = new ArchetypeShape(generateArchetypeParams(rng, morphology))
    geometries.push(buildArchetypeGeometry(shape, detail, radius))
  }
  cache.set(key, geometries)
  return geometries
}

export { getArchetypeGeometries, morphologyForIndex, morphologyRanges, archetypeLayout, MORPHOLOGY_ORDER }
export type { MorphologyRange, LibraryCategory, ArchetypeLayout, RealModelsOverride }
