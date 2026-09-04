import { ASTEROID_PROFILES } from '../AsteroidProfiles'
import { shapeModelPath } from './ShapeModelFormat'

/**
 * Пути бинарников реальных моделей всех профилей — для манифеста облака
 * (scripts/lib/cloudManifest): строк в БД у моделей нет, рантайм грузит их по
 * именам из профилей, поэтому белый список синка выводится из того же источника.
 */
export function shapeModelManifestPaths(): string[] {
  const paths = new Set<string>()
  for (const profile of Object.values(ASTEROID_PROFILES)) {
    for (const name of profile.shapeModels) {
      paths.add(shapeModelPath(name, 'l0'))
      paths.add(shapeModelPath(name, 'near'))
    }
  }
  return [...paths].sort()
}
