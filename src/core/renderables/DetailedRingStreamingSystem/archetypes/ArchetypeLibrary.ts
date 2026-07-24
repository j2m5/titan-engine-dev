import { BufferGeometry } from 'three'
import { ASTEROID_PROFILES, type AsteroidProfileName } from '../AsteroidProfiles'
import { SeededRandom, hashSectorKey } from '../SeededRandom'
import { ArchetypeShape, generateArchetypeParams } from './ArchetypeShape'
import { buildArchetypeGeometry } from './ArchetypeGeometry'

/**
 * Библиотека запечённых архетипов: K форм на профиль. Кэш модульный —
 * кольца одного профиля/конфигурации делят геометрии (single source
 * VBO, память не растёт с числом колец). Сид k-го архетипа независим от
 * count → усечение/расширение библиотеки не «пере жёвывает» формы.
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
    const shape = new ArchetypeShape(generateArchetypeParams(rng))
    geometries.push(buildArchetypeGeometry(shape, detail, radius))
  }
  cache.set(key, geometries)
  return geometries
}

export { getArchetypeGeometries }
