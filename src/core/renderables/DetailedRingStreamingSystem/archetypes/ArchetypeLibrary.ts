import { BufferGeometry } from 'three'
import { ASTEROID_PROFILES, type AsteroidProfileName } from '../AsteroidProfiles'
import { SeededRandom, hashSectorKey } from '../SeededRandom'
import { ArchetypeShape, generateArchetypeParams, type ArchetypeMorphology } from './ArchetypeShape'
import { buildArchetypeGeometry } from './ArchetypeGeometry'

/**
 * Число архетипов каждой морфологии в библиотеке из `count` штук: пороговое
 * разбиение по кумулятивным весам профиля (round(count·wFragment) первых —
 * fragment, следующие round(count·(wFragment+wRubble)) - fragment — rubble,
 * остаток — cratered). При count ≥ 3 округление может выродить одну из
 * категорий в 0 при ненулевом весе — тогда у неё отбирается один индекс у
 * категории с наибольшим текущим избытком (детерминированно: перебор в
 * порядке fragment → rubble → cratered, наибольший донор побеждает).
 */
function morphologyCounts(
  profile: AsteroidProfileName,
  count: number
): Record<ArchetypeMorphology, number> {
  const w = ASTEROID_PROFILES[profile].morphologyWeights

  const fragmentEnd = Math.round(count * w.fragment)
  const rubbleEnd = Math.round(count * (w.fragment + w.rubble))
  const counts = [fragmentEnd, rubbleEnd - fragmentEnd, count - rubbleEnd]

  if (count >= 3) {
    const weightsArr = [w.fragment, w.rubble, w.cratered]
    const mins = weightsArr.map((v) => (v > 0 ? 1 : 0))
    for (let i = 0; i < 3; i++) {
      while (counts[i] < mins[i]) {
        let donor = -1
        for (let j = 0; j < 3; j++) {
          if (j === i) continue
          if (counts[j] > mins[j] && (donor === -1 || counts[j] > counts[donor])) {
            donor = j
          }
        }
        if (donor === -1) break
        counts[donor]--
        counts[i]++
      }
    }
  }

  return { fragment: counts[0], rubble: counts[1], cratered: counts[2] }
}

/**
 * Морфология k-го архетипа библиотеки из `count` штук профиля `profile`
 * (чистая функция — тестируется отдельно от кэша геометрий). Преемственность:
 * k=0 всегда 'fragment' (fragment — самая тяжёлая доля во всех профилях,
 * округление даёт ей минимум 1 индекс уже при count=1).
 */
function morphologyForIndex(
  profile: AsteroidProfileName,
  k: number,
  count: number
): ArchetypeMorphology {
  const counts = morphologyCounts(profile, count)
  if (k < counts.fragment) return 'fragment'
  if (k < counts.fragment + counts.rubble) return 'rubble'
  return 'cratered'
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

export { getArchetypeGeometries, morphologyForIndex }
