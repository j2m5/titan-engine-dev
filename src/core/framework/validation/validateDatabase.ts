import {
  IActor,
  ICategory,
  IOrbit,
  IPhysicalObject,
  IPlacement,
  IRenderingObject,
  IResource,
  IRotationObject,
  IActorResource
} from '@/core/models/types'

/**
 * Валидатор целостности данных приложения.
 *
 * Чистая функция над снимком всех коллекций: не читает database напрямую,
 * а принимает данные аргументом. Благодаря этому переиспользуется в двух местах:
 *  - как vitest-тест над реальным database (страховка от рассинхрона ID);
 *  - как движок проверок внутри будущего CRUD-редактора (валидация на лету).
 *
 * Уровни:
 *  - error: ломает рантайм или семантику FK. Сборка данных невалидна.
 *  - warning: подозрительно (неполнота контента), но рантайм переживёт.
 */

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: IssueLevel
  collection: string
  /** id или индекс проблемной записи, если применимо */
  entity?: number | string
  message: string
}

export interface DatabaseSnapshot {
  categories: ICategory[]
  actors: IActor[]
  orbits: IOrbit[]
  rotationObjects: IRotationObject[]
  physicalObjects: IPhysicalObject[]
  renderingObjects: IRenderingObject[]
  placements: IPlacement[]
  resources: IResource[]
  actorResource: IActorResource[]
}

/** Ссылки сценариев на сущности БД — проверяются отдельно (живут в config) */
export interface ScenarioRefs {
  id: number
  rootId: number
  lightSources: number[]
  skybox: number[]
}

export interface ValidationResult {
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  ok: boolean
}

/** Категории-«анкоры»: для них отсутствие physical/rendering/orbit — норма */
const ANCHOR_CATEGORY_ALIASES = new Set(['universe', 'galaxy', 'starSystem', 'barycenter'])

/** Категории центральных тел: отсутствие orbit допустимо (звезда/дыра в центре системы) */
const CENTRAL_CATEGORY_ALIASES = new Set(['star', 'blackHole'])

function buildIdSet<T extends { id: number }>(rows: T[]): Set<number> {
  const set = new Set<number>()
  for (const row of rows) set.add(row.id)
  return set
}

/**
 * Проверяет уникальность первичных ключей внутри коллекции.
 */
function checkUniqueIds<T extends { id: number }>(rows: T[], collection: string, issues: ValidationIssue[]): void {
  const seen = new Set<number>()

  for (const row of rows) {
    if (seen.has(row.id)) {
      issues.push({
        level: 'error',
        collection,
        entity: row.id,
        message: `Duplicate id ${row.id} in "${collection}"`
      })
    }
    seen.add(row.id)
  }
}

/**
 * Проверяет, что значение внешнего ключа указывает на существующую запись.
 * nullable=true допускает null/undefined (например, parentId корня).
 */
function checkForeignKey(
  value: number | null | undefined,
  targetIds: Set<number>,
  opts: { collection: string; entity: number; field: string; nullable: boolean },
  issues: ValidationIssue[]
): void {
  if (value === null || value === undefined) {
    if (!opts.nullable) {
      issues.push({
        level: 'error',
        collection: opts.collection,
        entity: opts.entity,
        message: `${opts.collection}#${opts.entity}.${opts.field} is required but null`
      })
    }
    return
  }

  if (!targetIds.has(value)) {
    issues.push({
      level: 'error',
      collection: opts.collection,
      entity: opts.entity,
      message: `${opts.collection}#${opts.entity}.${opts.field}=${value} references missing record`
    })
  }
}

/**
 * Проверяет кардинальность hasOne: не больше одной записи на одного актора.
 */
function checkHasOneCardinality<T extends { id: number; actorId: number }>(
  rows: T[],
  collection: string,
  issues: ValidationIssue[]
): void {
  const perActor = new Map<number, number[]>()

  for (const row of rows) {
    const list = perActor.get(row.actorId) ?? []
    list.push(row.id)
    perActor.set(row.actorId, list)
  }

  for (const [actorId, ids] of perActor) {
    if (ids.length > 1) {
      issues.push({
        level: 'error',
        collection,
        entity: actorId,
        message: `Actor ${actorId} has ${ids.length} "${collection}" records (ids: ${ids.join(', ')}), expected at most 1`
      })
    }
  }
}

/**
 * Обнаруживает циклы и самоссылки в дереве акторов по parentId.
 */
function checkActorTree(actors: IActor[], issues: ValidationIssue[]): void {
  const byId = new Map<number, IActor>()
  for (const a of actors) byId.set(a.id, a)

  for (const actor of actors) {
    if (actor.parentId === actor.id) {
      issues.push({
        level: 'error',
        collection: 'actors',
        entity: actor.id,
        message: `Actor ${actor.id} is its own parent`
      })
      continue
    }

    // идём вверх по родителям, ловим цикл
    const visited = new Set<number>([actor.id])
    let current: number | null = actor.parentId

    while (current !== null && current !== undefined) {
      if (visited.has(current)) {
        issues.push({
          level: 'error',
          collection: 'actors',
          entity: actor.id,
          message: `Cycle in actor tree involving ${actor.id} (revisits ${current})`
        })
        break
      }
      visited.add(current)
      const parent: IActor | undefined = byId.get(current)
      if (!parent) break // висячий parentId уже поймает checkForeignKey
      current = parent.parentId
    }
  }
}

export function validateDatabase(db: DatabaseSnapshot, scenarios: ScenarioRefs[] = []): ValidationResult {
  const issues: ValidationIssue[] = []

  const categoryIds = buildIdSet(db.categories)
  const actorIds = buildIdSet(db.actors)
  const resourceIds = buildIdSet(db.resources)

  // алиас категории по id — для семантических предупреждений
  const categoryAliasById = new Map<number, string>()
  for (const c of db.categories) categoryAliasById.set(c.id, c.alias)

  // --- 1. Уникальность ID во всех коллекциях ---
  checkUniqueIds(db.categories, 'categories', issues)
  checkUniqueIds(db.actors, 'actors', issues)
  checkUniqueIds(db.orbits, 'orbits', issues)
  checkUniqueIds(db.rotationObjects, 'rotationObjects', issues)
  checkUniqueIds(db.physicalObjects, 'physicalObjects', issues)
  checkUniqueIds(db.renderingObjects, 'renderingObjects', issues)
  checkUniqueIds(db.placements, 'placements', issues)
  checkUniqueIds(db.resources, 'resources', issues)
  checkUniqueIds(db.actorResource, 'actorResource', issues)

  // --- 2. Внешние ключи акторов ---
  for (const actor of db.actors) {
    // categoryId может быть числом или строковым алиасом (IActor допускает оба)
    if (typeof actor.categoryId === 'number') {
      checkForeignKey(
        actor.categoryId,
        categoryIds,
        { collection: 'actors', entity: actor.id, field: 'categoryId', nullable: false },
        issues
      )
    } else if (!db.categories.some((c) => c.alias === actor.categoryId)) {
      issues.push({
        level: 'error',
        collection: 'actors',
        entity: actor.id,
        message: `actors#${actor.id}.categoryId="${actor.categoryId}" is not a known category alias`
      })
    }

    checkForeignKey(
      actor.parentId,
      actorIds,
      { collection: 'actors', entity: actor.id, field: 'parentId', nullable: true },
      issues
    )
  }

  // --- 3. Дерево акторов: циклы и самоссылки ---
  checkActorTree(db.actors, issues)

  // --- 4. FK дочерних коллекций -> actors ---
  const childCollections: Array<{ name: string; rows: Array<{ id: number; actorId: number }> }> = [
    { name: 'orbits', rows: db.orbits },
    { name: 'rotationObjects', rows: db.rotationObjects },
    { name: 'physicalObjects', rows: db.physicalObjects },
    { name: 'renderingObjects', rows: db.renderingObjects },
    { name: 'placements', rows: db.placements }
  ]

  for (const { name, rows } of childCollections) {
    for (const row of rows) {
      checkForeignKey(
        row.actorId,
        actorIds,
        { collection: name, entity: row.id, field: 'actorId', nullable: false },
        issues
      )
    }
  }

  // physicalObjects.parentId ссылается на другой physicalObject (по данным SgrA/Solar)
  const physicalIds = buildIdSet(db.physicalObjects)
  for (const phys of db.physicalObjects) {
    checkForeignKey(
      phys.parentId,
      physicalIds,
      { collection: 'physicalObjects', entity: phys.id, field: 'parentId', nullable: true },
      issues
    )
  }

  // --- 5. pivot actor_resource: уникальность id + оба FK валидны ---
  checkUniqueIds(db.actorResource, 'actorResource', issues)
  for (const link of db.actorResource) {
    checkForeignKey(
      link.actorId,
      actorIds,
      { collection: 'actorResource', entity: link.id, field: 'actorId', nullable: false },
      issues
    )
    checkForeignKey(
      link.resourceId,
      resourceIds,
      { collection: 'actorResource', entity: link.id, field: 'resourceId', nullable: false },
      issues
    )
  }

  // --- 6. Кардинальность hasOne: orbit / rotation / physical / rendering ---
  checkHasOneCardinality(db.orbits, 'orbits', issues)
  checkHasOneCardinality(db.rotationObjects, 'rotationObjects', issues)
  checkHasOneCardinality(db.physicalObjects, 'physicalObjects', issues)
  checkHasOneCardinality(db.renderingObjects, 'renderingObjects', issues)
  checkHasOneCardinality(db.placements, 'placements', issues)

  // --- 6b. Физически невозможные значения (warning) ---
  for (const phys of db.physicalObjects) {
    if (phys.mass <= 0) {
      issues.push({
        level: 'warning',
        collection: 'physicalObjects',
        entity: phys.id,
        message: `physicalObjects#${phys.id} (actor ${phys.actorId}) has non-positive mass: ${phys.mass}`
      })
    }
    if (phys.radius <= 0) {
      issues.push({
        level: 'warning',
        collection: 'physicalObjects',
        entity: phys.id,
        message: `physicalObjects#${phys.id} (actor ${phys.actorId}) has non-positive radius: ${phys.radius}`
      })
    }
    if (phys.orbitalPeriod < 0 || phys.rotationPeriod < 0) {
      issues.push({
        level: 'warning',
        collection: 'physicalObjects',
        entity: phys.id,
        message: `physicalObjects#${phys.id} (actor ${phys.actorId}) has negative period`
      })
    }
  }

  for (const orbit of db.orbits) {
    // JD 2000000–3000000 покрывает годы ~763–2739; значения вне — скорее всего
    // в поле записан календарный год или секунды вместо юлианской даты
    if (!Number.isFinite(orbit.epoch) || orbit.epoch < 2000000 || orbit.epoch > 3000000) {
      issues.push({
        level: 'warning',
        collection: 'orbits',
        entity: orbit.id,
        message: `orbits#${orbit.id} (actor ${orbit.actorId}) has implausible elements epoch (expected Julian Date): ${orbit.epoch}`
      })
    }
    if (!Number.isFinite(orbit.period) || orbit.period < 0) {
      issues.push({
        level: 'warning',
        collection: 'orbits',
        entity: orbit.id,
        message: `orbits#${orbit.id} (actor ${orbit.actorId}) has invalid period (days, 0=auto): ${orbit.period}`
      })
    }
  }

  // --- 7. Предупреждения о полноте контента ---
  const actorsWithPhysical = new Set(db.physicalObjects.map((p) => p.actorId))
  const actorsWithRendering = new Set(db.renderingObjects.map((r) => r.actorId))
  const actorsWithOrbit = new Set(db.orbits.map((o) => o.actorId))

  for (const actor of db.actors) {
    const alias = typeof actor.categoryId === 'number' ? categoryAliasById.get(actor.categoryId) : actor.categoryId

    if (alias === undefined) continue // битый categoryId уже как error выше

    const isAnchor = ANCHOR_CATEGORY_ALIASES.has(alias)
    const isCentral = CENTRAL_CATEGORY_ALIASES.has(alias)

    if (!isAnchor) {
      if (!actorsWithPhysical.has(actor.id)) {
        issues.push({
          level: 'warning',
          collection: 'actors',
          entity: actor.id,
          message: `Actor ${actor.id} (${alias}) "${actor.name}" has no physicalObject`
        })
      }
      if (!actorsWithRendering.has(actor.id)) {
        issues.push({
          level: 'warning',
          collection: 'actors',
          entity: actor.id,
          message: `Actor ${actor.id} (${alias}) "${actor.name}" has no renderingObject`
        })
      }
      if (!isCentral && !actorsWithOrbit.has(actor.id)) {
        issues.push({
          level: 'warning',
          collection: 'actors',
          entity: actor.id,
          message: `Actor ${actor.id} (${alias}) "${actor.name}" has no orbit`
        })
      }
    }
  }

  // --- 8. Ссылки сценариев (живут в config, но указывают на БД) ---
  for (const sc of scenarios) {
    checkForeignKey(
      sc.rootId,
      actorIds,
      { collection: 'scenarios', entity: sc.id, field: 'rootId', nullable: false },
      issues
    )
    for (const lightId of sc.lightSources) {
      checkForeignKey(
        lightId,
        actorIds,
        { collection: 'scenarios', entity: sc.id, field: 'lightSources[]', nullable: false },
        issues
      )
    }
    for (const resId of sc.skybox) {
      checkForeignKey(
        resId,
        resourceIds,
        { collection: 'scenarios', entity: sc.id, field: 'skybox[]', nullable: false },
        issues
      )
    }
  }

  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  return { issues, errors, warnings, ok: errors.length === 0 }
}
