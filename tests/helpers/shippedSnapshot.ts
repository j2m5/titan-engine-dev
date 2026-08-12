import { DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'

/**
 * Снимок поставляемой базы через тот же реестр, которым пользуется приложение.
 * `database` объявлена как `Map<string, unknown>`, поэтому каст неизбежен —
 * он один и заперт в `table`, а не размазан по девяти полям в двух тестах.
 *
 * Импорт динамический: тесты грузили базу лениво, порядок инициализации модулей
 * сохраняем.
 */
export async function shippedSnapshot(): Promise<DatabaseSnapshot> {
  const { database } = await import('@/config/database')

  const table = <K extends keyof DatabaseSnapshot>(key: K): DatabaseSnapshot[K] =>
    database.get(key) as DatabaseSnapshot[K]

  return {
    categories: table('categories'),
    actors: table('actors'),
    orbits: table('orbits'),
    rotationObjects: table('rotationObjects'),
    physicalObjects: table('physicalObjects'),
    renderingObjects: table('renderingObjects'),
    placements: table('placements'),
    resources: table('resources'),
    actorResource: table('actorResource')
  }
}
