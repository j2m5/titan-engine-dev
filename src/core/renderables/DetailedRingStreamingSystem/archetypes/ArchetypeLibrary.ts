import { BufferGeometry } from 'three'
import { ASTEROID_PROFILES, type AsteroidProfileName } from '../AsteroidProfiles'
import { SeededRandom, hashSectorKey } from '../SeededRandom'
import { ArchetypeShape, generateArchetypeParams, type ArchetypeMorphology } from './ArchetypeShape'
import { buildArchetypeGeometry } from './ArchetypeGeometry'

/**
 * Порядок категорий в библиотеке: индексы каждой морфологии контигуальны и идут
 * в этом порядке. fragment первым — k=0 всегда осколок (преемственность кэша).
 */
const MORPHOLOGY_ORDER: readonly ArchetypeMorphology[] = ['fragment', 'rubble', 'binary', 'top', 'cratered']

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

/** Диапазон индексов библиотеки одной морфологии (start, count); count может быть 0 */
interface MorphologyRange {
  morphology: ArchetypeMorphology
  start: number
  count: number
}

/**
 * Диапазоны индексов библиотеки по морфологиям в порядке MORPHOLOGY_ORDER —
 * для раскладки инстансов по размеру (см. AsteroidGenerator.pickArchetype).
 */
function morphologyRanges(profile: AsteroidProfileName, count: number): MorphologyRange[] {
  const counts = morphologyCounts(profile, count)
  const ranges: MorphologyRange[] = []
  let start = 0
  for (const morphology of MORPHOLOGY_ORDER) {
    ranges.push({ morphology, start, count: counts[morphology] })
    start += counts[morphology]
  }
  return ranges
}

/**
 * Морфология k-го архетипа библиотеки из `count` штук профиля `profile`
 * (чистая функция — тестируется отдельно от кэша геометрий). Преемственность:
 * k=0 всегда 'fragment' (fragment — самая тяжёлая доля во всех профилях,
 * округление даёт ей минимум 1 индекс уже при count=1).
 */
function morphologyForIndex(profile: AsteroidProfileName, k: number, count: number): ArchetypeMorphology {
  for (const range of morphologyRanges(profile, count)) {
    if (k < range.start + range.count) return range.morphology
  }
  return MORPHOLOGY_ORDER[MORPHOLOGY_ORDER.length - 1]
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
    // Сид согласован с 2a: k=0 воспроизводит прежний единственный архетип
    const rng = new SeededRandom(hashSectorKey(0xa57, k, profileIndex))
    const shape = new ArchetypeShape(generateArchetypeParams(rng, morphologyForIndex(profile, k, count)))
    geometries.push(buildArchetypeGeometry(shape, detail, radius))
  }
  cache.set(key, geometries)
  return geometries
}

export { getArchetypeGeometries, morphologyForIndex, morphologyRanges, MORPHOLOGY_ORDER }
export type { MorphologyRange }
