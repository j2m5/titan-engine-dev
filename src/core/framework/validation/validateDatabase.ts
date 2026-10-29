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
import { NEBULA_SHAPE_IDS } from '@/core/renderables/Nebula/NebulaParams'
import { ringMoonletProblems } from '@/core/renderables/DetailedRingStreamingSystem/ringMoonlets'
import { LinearSRGBColorSpace, NoColorSpace, SRGBColorSpace } from 'three'
import { resolveCloudConfig } from '@/core/clouds/validateCloudConfig'

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

/**
 * Как категория получает свою позицию в мире.
 *
 *  - keplerian: DynamicNode пересчитывает position каждый кадр из орбиты;
 *  - attached:  своей позиции нет вообще — узел монтируется в equatorialFrame
 *               родителя и движется вместе с ним (кольца, атмосферы);
 *  - placed:    собственный статический трансформ из placements (туманности).
 */
type Positioning = 'keplerian' | 'attached' | 'placed'

interface CategoryRules {
  positioning: Positioning
  /** какие связи ожидаются: отсутствие даёт warning о неполноте контента */
  expects: { physical: boolean; rendering: boolean; orbit: boolean }
}

const ANCHOR: CategoryRules = {
  positioning: 'keplerian',
  expects: { physical: false, rendering: false, orbit: false }
}

/** Центральное тело системы: орбиты нет, остальное обязательно */
const CENTRAL: CategoryRules = {
  positioning: 'keplerian',
  expects: { physical: true, rendering: true, orbit: false }
}

/**
 * Несамостоятельная сущность: ни своего движения, ни своих массы и радиуса.
 * Её радиусы живут в собственной data, а позицию целиком задаёт родитель.
 */
const ATTACHED: CategoryRules = {
  positioning: 'attached',
  expects: { physical: false, rendering: true, orbit: false }
}

const CATEGORY_RULES: Record<string, CategoryRules> = {
  // алиасы-задел: в AllowedCategories их пока нет, поведение сохранено прежним
  universe: ANCHOR,
  galaxy: ANCHOR,
  starSystem: ANCHOR,
  barycenter: ANCHOR,

  star: CENTRAL,
  blackHole: CENTRAL,
  brownDwarf: CENTRAL,
  whiteDwarf: CENTRAL,
  giantStar: CENTRAL,
  pulsar: CENTRAL,
  planet: { positioning: 'keplerian', expects: { physical: true, rendering: true, orbit: true } },

  atmosphere: ATTACHED,
  ring: ATTACHED,

  nebula: { positioning: 'placed', expects: { physical: false, rendering: true, orbit: false } },
  asteroidBelt: { positioning: 'placed', expects: { physical: false, rendering: true, orbit: false } }
}

/** Неизвестная категория трактуется строго: кеплерова и обязана иметь всё */
const DEFAULT_RULES: CategoryRules = {
  positioning: 'keplerian',
  expects: { physical: true, rendering: true, orbit: true }
}

function rulesFor(alias: string): CategoryRules {
  return CATEGORY_RULES[alias] ?? DEFAULT_RULES
}

/**
 * Строка позиционирования, несовместимая с режимом категории, — ошибка, а не
 * предупреждение: в рантайме она молча проигрывает (DynamicNode перетирает
 * position, equatorialFrame игнорирует смещение), то есть данные врут о том,
 * где объект находится.
 */
function checkPositioning(db: DatabaseSnapshot, aliasByActor: Map<number, string>, issues: ValidationIssue[]): void {
  for (const placement of db.placements) {
    const alias = aliasByActor.get(placement.actorId)
    if (alias === undefined) continue

    const { positioning } = rulesFor(alias)
    if (positioning !== 'placed') {
      issues.push({
        level: 'error',
        collection: 'placements',
        entity: placement.id,
        message:
          `placements#${placement.id} (actor ${placement.actorId}, ${alias}) will never be applied: ` +
          `the category is positioned as "${positioning}", not "placed"`
      })
      continue
    }

    // Точка Лагранжа считается по орбите РОДИТЕЛЯ: без неё узел стоит в нуле.
    if (placement.lagrange !== undefined) {
      const actor = db.actors.find((a) => a.id === placement.actorId)
      const parentHasOrbit = actor?.parentId != null && db.orbits.some((o) => o.actorId === actor.parentId)
      if (placement.lagrange !== 4 && placement.lagrange !== 5) {
        issues.push({
          level: 'error',
          collection: 'placements',
          entity: placement.id,
          message: `placements#${placement.id} (actor ${placement.actorId}) lagrange must be 4 or 5, got ${placement.lagrange}`
        })
      } else if (!parentHasOrbit) {
        issues.push({
          level: 'error',
          collection: 'placements',
          entity: placement.id,
          message:
            `placements#${placement.id} (actor ${placement.actorId}) lagrange ${placement.lagrange} needs a parent with an orbit ` +
            `— the node would stay at the parent's origin`
        })
      }
    }
  }

  for (const orbit of db.orbits) {
    const alias = aliasByActor.get(orbit.actorId)
    if (alias === undefined) continue

    const { positioning } = rulesFor(alias)
    if (positioning !== 'keplerian') {
      issues.push({
        level: 'error',
        collection: 'orbits',
        entity: orbit.id,
        message:
          `orbits#${orbit.id} (actor ${orbit.actorId}, ${alias}) will never be applied: ` +
          `the category is positioned as "${positioning}", not "keplerian"`
      })
    }
  }
}

/** Спектральные тройки атмосферы: [R, G, B], конечные числа */
const ATMOSPHERE_TRIPLES = [
  'solarIrradiance',
  'rayleighScattering',
  'mieScattering',
  'mieExtinction',
  'absorptionExtinction',
  'groundAlbedo'
] as const

/** Плотностные профили атмосферы: строго пара слоёв [layer0, layer1] */
const ATMOSPHERE_DENSITY_PAIRS = ['rayleighDensity', 'mieDensity', 'absorptionDensity'] as const

const DENSITY_LAYER_FIELDS = ['width', 'expTerm', 'expScale', 'linearTerm', 'constantTerm'] as const

function isDensityLayer(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return DENSITY_LAYER_FIELDS.every((f) => Number.isFinite((value as Record<string, unknown>)[f]))
}

/**
 * Форма данных выбранных атмосфер: битая структура
 * не ловится типами (data — свободный JSON) и роняет LUT-генератор в рантайме.
 */
function checkAtmosphereShapes(
  rows: IRenderingObject[],
  issues: ValidationIssue[]
): void {
  for (const row of rows) {
    const bad = (field: string, reason: string): void => {
      issues.push({
        level: 'error',
        collection: 'renderingObjects',
        entity: row.id,
        message: `renderingObjects#${row.id} (actor ${row.actorId}) atmosphere data.${field} ${reason}`
      })
    }

    for (const field of ATMOSPHERE_TRIPLES) {
      const v = row.data[field]
      if (!Array.isArray(v) || v.length !== 3 || !v.every((x: unknown) => Number.isFinite(x))) {
        bad(field, 'must be a [R, G, B] triple of finite numbers')
      }
    }

    for (const field of ATMOSPHERE_DENSITY_PAIRS) {
      const v = row.data[field]
      if (!Array.isArray(v) || v.length !== 2 || !v.every(isDensityLayer)) {
        bad(field, 'must be a pair of density layers [layer0, layer1]')
      }
    }

    for (const field of ['sunAngularRadius', 'miePhaseFunctionG', 'muSMin']) {
      if (typeof row.data[field] !== 'number' || !Number.isFinite(row.data[field])) {
        bad(field, 'must be a finite number')
      }
    }

    const scat = row.data.mieScattering
    const ext = row.data.mieExtinction
    if (Array.isArray(scat) && Array.isArray(ext) && scat.length === 3 && ext.length === 3) {
      if (scat.some((s: number, i: number) => Number.isFinite(s) && Number.isFinite(ext[i]) && s > ext[i] + 1e-12)) {
        issues.push({
          level: 'warning',
          collection: 'renderingObjects',
          entity: row.id,
          message: `renderingObjects#${row.id} (actor ${row.actorId}) mie extinction is below scattering (unphysical: extinction = scattering + absorption)`
        })
      }
    }
  }
}

/**
 * Якорь атмосферы: bottomRadius обязан совпадать с радиусом родительской
 * планеты. Аналитическая «земля» шейдера Брунетона и меш планеты — две
 * независимые сферы; рассогласование даёт видимый шов на горизонте —
 * атмосфера «отлипает» от поверхности (кейс Yavin Prime: 195550 vs 195500).
 * Заодно: bottom < top, иначе LUT-генератор молча производит NaN
 * (H = √(top² − bottom²)).
 */
function checkAtmosphereAnchoring(
  renderingObjects: IRenderingObject[],
  actors: IActor[],
  physicalObjects: IPhysicalObject[],
  issues: ValidationIssue[]
): void {
  const parentIdByActor = new Map<number, number | null>()
  for (const a of actors) parentIdByActor.set(a.id, a.parentId)

  const physByActor = new Map<number, IPhysicalObject>()
  for (const p of physicalObjects) physByActor.set(p.actorId, p)

  for (const row of renderingObjects) {
    const bottom: unknown = row.data.bottomRadius
    const top: unknown = row.data.topRadius

    if (
      typeof bottom !== 'number' ||
      typeof top !== 'number' ||
      !Number.isFinite(bottom) ||
      !Number.isFinite(top) ||
      bottom <= 0 ||
      top <= bottom
    ) {
      issues.push({
        level: 'error',
        collection: 'renderingObjects',
        entity: row.id,
        message:
          `renderingObjects#${row.id} (actor ${row.actorId}) atmosphere radii invalid: ` +
          `bottomRadius=${bottom}, topRadius=${top} (expected 0 < bottom < top)`
      })
      continue
    }

    const parentId = parentIdByActor.get(row.actorId)
    const parentPhys = parentId !== null && parentId !== undefined ? physByActor.get(parentId) : undefined
    if (!parentPhys || !Number.isFinite(parentPhys.radius)) continue

    if (Math.abs(bottom - parentPhys.radius) > Math.abs(parentPhys.radius) * 1e-9) {
      issues.push({
        level: 'error',
        collection: 'renderingObjects',
        entity: row.id,
        message:
          `renderingObjects#${row.id} (actor ${row.actorId}) atmosphere bottomRadius=${bottom} ` +
          `!= parent planet radius=${parentPhys.radius} — atmosphere will visually detach from the surface`
      })
    }
  }
}

/**
 * Протяжённость атмосферы задаёт ШКАЛА ВЫСОТ, а не topRadius.
 *
 * Плотность вещества — exp(−h/H), где H = −1/expScale. Видимая на лимбе
 * полоса набирается за первые ~7 шкал: выше оптическая толща падает ниже
 * порога, и оболочка там пуста. topRadius — только внешняя граница меша и
 * области определения LUT, собственной толщины он не даёт. Отсюда ловушка,
 * ради которой заведено правило: у тела с земной H (8–25 км) и большим
 * радиусом атмосфера выходит волосяной линией (Явин Прайм: 7H = 0.09% R,
 * доли пикселя на диске), а попытка «раздуть» её ростом topRadius не меняет
 * ничего — растёт только пустая оболочка. Толстая атмосфера газового
 * гиганта делается ростом H с пропорциональным ростом оболочки.
 *
 * Отсюда обе границы отношения оболочка/H:
 *   > MAX — за 20 шкал плотность 2·10⁻⁹, дальше оболочка пуста: topRadius
 *           тут можно только уменьшить, видимую атмосферу растит H;
 *   < MIN — профиль обрезан на плотности e⁻⁵ ≈ 7·10⁻³, на границе меша
 *           виден жёсткий край вместо плавного схода в вакуум.
 *
 * Вещество с нулевыми коэффициентами (у половины базы это озоновый слой)
 * в счёт не идёт: его профиль на картинку не влияет.
 */
const SHELL_SCALE_HEIGHTS_MIN = 5
const SHELL_SCALE_HEIGHTS_MAX = 20

/** Шкала высот exp-профиля идиомы expLayer() в км; 0 — профиль не экспоненциальный. */
function exponentialScaleHeight(profile: unknown): number {
  if (!Array.isArray(profile) || profile.length !== 2) return 0

  const top: unknown = profile[1]
  if (typeof top !== 'object' || top === null) return 0

  const { expScale, expTerm } = top as { expScale?: unknown; expTerm?: unknown }
  if (typeof expScale !== 'number' || typeof expTerm !== 'number') return 0
  if (!Number.isFinite(expScale) || expScale >= 0 || expTerm === 0) return 0

  return -1 / expScale
}

/** Вещество влияет на картинку, только если хоть один его коэффициент положителен. */
function isActiveSpecies(coefficients: unknown): boolean {
  return Array.isArray(coefficients) && coefficients.some((x: unknown) => typeof x === 'number' && x > 0)
}

function checkAtmosphereExtent(
  rows: IRenderingObject[],
  issues: ValidationIssue[]
): void {
  for (const row of rows) {
    const bottom: unknown = row.data.bottomRadius
    const top: unknown = row.data.topRadius

    // Битые радиусы уже отчитаны якорем — здесь молча пропускаем
    if (typeof bottom !== 'number' || typeof top !== 'number' || !(top > bottom)) continue

    const scaleHeights: number[] = []
    if (isActiveSpecies(row.data.rayleighScattering)) {
      scaleHeights.push(exponentialScaleHeight(row.data.rayleighDensity))
    }
    if (isActiveSpecies(row.data.mieExtinction)) {
      scaleHeights.push(exponentialScaleHeight(row.data.mieDensity))
    }
    if (isActiveSpecies(row.data.absorptionExtinction)) {
      scaleHeights.push(exponentialScaleHeight(row.data.absorptionDensity))
    }

    const scaleHeight = Math.max(0, ...scaleHeights)
    if (scaleHeight <= 0) continue

    const shell = top - bottom
    const shells = shell / scaleHeight

    const head =
      `renderingObjects#${row.id} (actor ${row.actorId}) atmosphere shell ${shell.toFixed(0)} km ` +
      `= ${shells.toFixed(1)} scale heights (H=${scaleHeight.toFixed(1)} km)`

    if (shells > SHELL_SCALE_HEIGHTS_MAX) {
      issues.push({
        level: 'warning',
        collection: 'renderingObjects',
        entity: row.id,
        message:
          `${head}: above ${SHELL_SCALE_HEIGHTS_MAX} the shell is vacuum — raising topRadius ` +
          `adds nothing, visible thickness grows with the density scale height`
      })
    } else if (shells < SHELL_SCALE_HEIGHTS_MIN) {
      issues.push({
        level: 'warning',
        collection: 'renderingObjects',
        entity: row.id,
        message:
          `${head}: the profile is cut at density ${Math.exp(-shells).toExponential(1)} — ` +
          `a hard edge shows at the shell boundary`
      })
    }
  }
}

/**
 * Формы берутся из ЕДИНОГО источника, а не из копии списка. Копия уже разошлась
 * однажды: shell, torus и hourglass завелись в NebulaShape и в шейдере, а
 * валидатор продолжал знать только два имени и забраковал всю поставляемую базу.
 */
const NEBULA_SHAPES = new Set<string>(Object.keys(NEBULA_SHAPE_IDS))
const NEBULA_PRESET_NAMES = new Set(['emission', 'reflection', 'dark'])
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function isPositiveTriple(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0)
  )
}

/** Сужение свободного JSON до объекта: null, массивы и примитивы дают undefined */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>) : undefined
}

/**
 * Форма конфига туманности. Диспетчеризация по алиасу категории, а не по
 * утиной типизации: в снимке есть и акторы, и категории, гадать по полям незачем.
 *
 * size обязателен: без него движок подставит дефолт ~0.013 а.е., то есть
 * туманность будет невидима — пропуск поля почти наверняка баг данных.
 */
function checkNebulaShapes(
  rows: IRenderingObject[],
  aliasByActor: Map<number, string>,
  issues: ValidationIssue[]
): void {
  for (const row of rows) {
    if (aliasByActor.get(row.actorId) !== 'nebula') continue

    const data: Record<string, unknown> = asRecord(row.data) ?? {}

    const bad = (field: string, reason: string): void => {
      issues.push({
        level: 'error',
        collection: 'renderingObjects',
        entity: row.id,
        message: `renderingObjects#${row.id} (actor ${row.actorId}) nebula data.${field} ${reason}`
      })
    }

    const size = data.size
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      bad('size', 'must be a positive number (astronomical units)')
    }

    const shape = data.shape
    if (shape !== undefined && (typeof shape !== 'string' || !NEBULA_SHAPES.has(shape))) {
      bad('shape', `must be one of: ${[...NEBULA_SHAPES].join(', ')}`)
    }

    const preset = data.preset
    if (preset !== undefined && (typeof preset !== 'string' || !NEBULA_PRESET_NAMES.has(preset))) {
      bad('preset', `must be one of: ${[...NEBULA_PRESET_NAMES].join(', ')}`)
    }

    if (data.axisRatios !== undefined && !isPositiveTriple(data.axisRatios)) {
      bad('axisRatios', 'must be a triple of positive finite numbers')
    }

    const palette = asRecord(data.palette)
    const dust = asRecord(data.dust)
    if (data.palette !== undefined && !palette) bad('palette', 'must be an object')

    const checkEntries = (
      field: string, value: unknown, check: (entry: Record<string, unknown>, path: string) => void
    ): void => {
      if (value === undefined) return
      if (!Array.isArray(value)) {
        bad(field, 'must be an array')
        return
      }
      value.forEach((entry: unknown, index: number) => {
        const path = `${field}[${index}]`
        const record = asRecord(entry)
        if (!record) bad(path, 'must be an object')
        else check(record, path)
      })
    }

    for (const field of ['lobes', 'cavities']) {
      checkEntries(field, data[field], (entry, path) => {
        if (entry.center !== undefined && (!Array.isArray(entry.center) || entry.center.length !== 3 ||
          !entry.center.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))) {
          bad(`${path}.center`, 'must be a triple of finite numbers')
        }
        const numbers = field === 'lobes' ? ['radius', 'weight', 'seed'] : ['radius', 'strength']
        for (const key of numbers) {
          if (entry[key] !== undefined && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]))) {
            bad(`${path}.${key}`, 'must be a finite number')
          }
        }
      })
    }

    const colors: Array<[string, unknown]> = [
      ['palette.secondary', palette?.secondary],
      ['dust.color', dust?.color]
    ]

    checkEntries('palette.stops', palette?.stops, (stop, path) => {
      if (typeof stop.color !== 'string' || !HEX_COLOR.test(stop.color)) {
        bad(`${path}.color`, 'must be a "#rrggbb" hex color string')
      }
      const t = stop.t
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 1) {
        bad(`${path}.t`, 'must be a number within [0, 1]')
      }
    })

    for (const [field, value] of colors) {
      if (value !== undefined && (typeof value !== 'string' || !HEX_COLOR.test(value))) {
        bad(field, 'must be a "#rrggbb" hex color string')
      }
    }
  }
}

/**
 * Лунки колец и сила подсветки от кольца (ringMoonletProblems — тот же
 * источник, что у резолвера кольца): радиус орбиты внутри кольца,
 * положительные размер и щель, известная модель формы, не больше 4 лунок.
 */
function checkRingMoonlets(
  rows: IRenderingObject[],
  aliasByActor: Map<number, string>,
  issues: ValidationIssue[]
): void {
  for (const row of rows) {
    if (aliasByActor.get(row.actorId) !== 'ring') continue
    for (const problem of ringMoonletProblems(asRecord(row.data) ?? {})) {
      issues.push({
        level: 'error',
        collection: 'renderingObjects',
        entity: row.id,
        message: `renderingObjects#${row.id} (actor ${row.actorId}) ring data.${problem}`
      })
    }
  }
}

/**
 * Форма конфига пояса астероидов. Радиусы в а.е.: inner < outer, оба
 * положительны — иначе distanceToTorus и профиль плотности делят на ноль.
 * spacingKm и sizeRangeKm — источник плотности/ячеек/порогов LOD (см.
 * deriveCascades), неположительные или невпорядоченные ломают вывод каскадов.
 */
function checkAsteroidBeltShapes(
  rows: IRenderingObject[],
  aliasByActor: Map<number, string>,
  issues: ValidationIssue[]
): void {
  for (const row of rows) {
    if (aliasByActor.get(row.actorId) !== 'asteroidBelt') continue

    const data: Record<string, unknown> = asRecord(row.data) ?? {}

    const bad = (field: string, reason: string): void => {
      issues.push({
        level: 'error',
        collection: 'renderingObjects',
        entity: row.id,
        message: `renderingObjects#${row.id} (actor ${row.actorId}) asteroidBelt data.${field} ${reason}`
      })
    }

    const inner = data.innerRadiusAu
    const outer = data.outerRadiusAu
    const innerValid = typeof inner === 'number' && Number.isFinite(inner) && inner > 0
    const outerValid = typeof outer === 'number' && Number.isFinite(outer) && outer > 0

    if (!innerValid) bad('innerRadiusAu', 'must be a positive number (astronomical units)')
    if (!outerValid) bad('outerRadiusAu', 'must be a positive number (astronomical units)')
    if (innerValid && outerValid && !((inner as number) < (outer as number))) {
      bad('outerRadiusAu', 'must be greater than data.innerRadiusAu')
    }

    const thickness = data.thicknessAu
    if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
      bad('thicknessAu', 'must be a positive number (astronomical units)')
    }

    const spacing = data.spacingKm
    if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0) {
      bad('spacingKm', 'must be a positive number (kilometers)')
    }

    const sizeRange = data.sizeRangeKm
    const sizeMin = Array.isArray(sizeRange) ? sizeRange[0] : undefined
    const sizeMax = Array.isArray(sizeRange) ? sizeRange[1] : undefined
    const sizeMinValid = typeof sizeMin === 'number' && Number.isFinite(sizeMin) && sizeMin > 0

    if (!sizeMinValid) bad('sizeRangeKm[0]', 'must be a positive number (kilometers)')
    if (sizeMinValid && !(typeof sizeMax === 'number' && Number.isFinite(sizeMax) && sizeMax > (sizeMin as number))) {
      bad('sizeRangeKm[1]', 'must be greater than data.sizeRangeKm[0]')
    }
  }
}

/**
 * Обязательные числовые поля строк (необязательные — direction, lagrange — в
 * списке нет). Форма редактора пишет пустое поле как null, мусор — как NaN, а
 * генератор сериализует любое не-конечное число в null: такая строка даёт
 * NaN-позиции и вращение (тело пропадает со сцены) и ломает тип
 * сгенерированного файла. Поэтому ошибка, а не предупреждение — сохранение
 * блокируется.
 */
const REQUIRED_NUMBERS = {
  orbits: [
    'semiMajorAxis',
    'eccentricity',
    'inclination',
    'argOfPeriapsis',
    'ascendingNode',
    'meanAnomalyAtEpoch',
    'epoch',
    'period'
  ],
  rotationObjects: ['meridianAngle', 'ascendingNode', 'inclination', 'period'],
  physicalObjects: ['mass', 'radius', 'axialTilt', 'rotationPeriod', 'temperature'],
  placements: ['x', 'y', 'z']
} as const satisfies { [K in keyof DatabaseSnapshot]?: ReadonlyArray<keyof DatabaseSnapshot[K][number]> }

function checkRequiredNumbers(db: DatabaseSnapshot, issues: ValidationIssue[]): void {
  for (const collection of Object.keys(REQUIRED_NUMBERS) as Array<keyof typeof REQUIRED_NUMBERS>) {
    const fields: readonly string[] = REQUIRED_NUMBERS[collection]

    for (const row of db[collection] as unknown as Array<Record<string, unknown> & { id: number }>) {
      for (const field of fields) {
        const value = row[field]

        if (typeof value === 'number' && Number.isFinite(value)) continue

        issues.push({
          level: 'error',
          collection,
          entity: row.id,
          message: `${collection}#${row.id}.${field} must be a finite number, got ${String(value)}`
        })
      }
    }
  }
}

/** JSON.parse допускает 1e400 → Infinity, а генератор записал бы его как null. */
function checkRenderingNumbers(rows: IRenderingObject[], issues: ValidationIssue[]): void {
  for (const row of rows) {
    const visit = (value: unknown, path: string): void => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        issues.push({
          level: 'error',
          collection: 'renderingObjects',
          entity: row.id,
          message: `renderingObjects#${row.id} ${path} must be a finite number, got ${String(value)}`
        })
      } else if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, `${path}[${index}]`))
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, entry] of Object.entries(value)) visit(entry, `${path}.${key}`)
      }
    }
    visit(row.data, 'data')
  }
}

/** Validate the ellipse/hyperbola domain implemented by KeplerianModel. */
function checkOrbitDomain(db: DatabaseSnapshot, issues: ValidationIssue[]): void {
  for (const orbit of db.orbits) {
    const { semiMajorAxis: a, eccentricity: e } = orbit
    if (!Number.isFinite(a) || !Number.isFinite(e)) continue

    const bad = (field: 'semiMajorAxis' | 'eccentricity', reason: string): void => {
      issues.push({
        level: 'error',
        collection: 'orbits',
        entity: orbit.id,
        message: `orbits#${orbit.id}.${field} ${reason}`
      })
    }

    if (e < 0) {
      bad('eccentricity', 'must be non-negative')
      continue
    }

    if (e === 1) {
      bad('eccentricity', 'must be less than 1 or greater than 1; parabolic orbits are unsupported')
      continue
    }

    // KeplerianModel intentionally treats the NullOrbit (a=0, e=0) as stationary.
    if (a === 0) {
      if (e !== 0) bad('semiMajorAxis', 'zero semiMajorAxis requires zero eccentricity for a stationary orbit')
      continue
    }

    if (e < 1 && a < 0) {
      bad('semiMajorAxis', 'must be positive for an ellipse (eccentricity < 1)')
    } else if (e > 1 && a > 0) {
      bad('semiMajorAxis', 'must be negative for a hyperbola (eccentricity > 1)')
    }
  }
}

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

  // алиас категории по актору — для правил позиционирования и проверок формы
  const aliasByActor = new Map<number, string>()
  for (const actor of db.actors) {
    const alias = categoryAliasById.get(actor.categoryId)
    if (alias !== undefined) aliasByActor.set(actor.id, alias)
  }

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
    // Проверяем и runtime-вход: старый JSON может содержать alias вместо FK.
    if (typeof actor.categoryId === 'number') {
      checkForeignKey(
        actor.categoryId,
        categoryIds,
        { collection: 'actors', entity: actor.id, field: 'categoryId', nullable: false },
        issues
      )
    } else {
      issues.push({
        level: 'error',
        collection: 'actors',
        entity: actor.id,
        message: `actors#${actor.id}.categoryId must be a numeric category ID`
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

  // --- 6a. Обязательные числа: null/NaN/Infinity — ошибка (см. REQUIRED_NUMBERS) ---
  checkRequiredNumbers(db, issues)
  checkOrbitDomain(db, issues)

  for (const resource of db.resources) {
    const value = resource.colorSpace
    if (value !== undefined && value !== NoColorSpace && value !== SRGBColorSpace && value !== LinearSRGBColorSpace) {
      issues.push({
        level: 'error', collection: 'resources', entity: resource.id,
        message: `resources#${resource.id} colorSpace must be omitted, "", "srgb" or "srgb-linear"`
      })
    }
  }

  for (const rotation of db.rotationObjects) {
    if (rotation.direction !== undefined && rotation.direction !== 1 && rotation.direction !== -1) {
      issues.push({
        level: 'error', collection: 'rotationObjects', entity: rotation.id,
        message: `rotationObjects#${rotation.id} direction must be 1 or -1, got ${rotation.direction}`
      })
    }
  }

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
    if (phys.rotationPeriod < 0) {
      issues.push({
        level: 'warning',
        collection: 'physicalObjects',
        entity: phys.id,
        message: `physicalObjects#${phys.id} (actor ${phys.actorId}) has negative rotation period`
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

  // Reject invalid input before specialized validators inspect object properties.
  const renderingObjects = db.renderingObjects.filter((row) => {
    if (row.data !== null && typeof row.data === 'object' && !Array.isArray(row.data)) return true
    issues.push({
      level: 'error', collection: 'renderingObjects', entity: row.id,
      message: `renderingObjects#${row.id} data must be a non-null JSON object`
    })
    return false
  })

  // --- 6c. Форма данных атмосфер (битая структура роняет LUT-генератор в рантайме) ---
  // Категория задаёт схему даже без обязательных полей. Сохраняем и старую
  // диагностику atmosphere-подобных данных, записанных в другую категорию.
  const atmospheres = renderingObjects.filter((row) =>
    aliasByActor.get(row.actorId) === 'atmosphere' || 'solarIrradiance' in row.data)
  checkAtmosphereShapes(atmospheres, issues)

  // --- 6d. Якорь атмосферы: bottomRadius == радиус родительской планеты ---
  checkAtmosphereAnchoring(atmospheres, db.actors, db.physicalObjects, issues)

  // --- 6g. Протяжённость атмосферы: оболочка против шкалы высот ---
  checkAtmosphereExtent(atmospheres, issues)

  // --- 6f. Форма конфига туманностей ---
  checkNebulaShapes(renderingObjects, aliasByActor, issues)

  // --- 6h. Форма конфига пояса астероидов ---
  checkAsteroidBeltShapes(renderingObjects, aliasByActor, issues)
  checkRingMoonlets(renderingObjects, aliasByActor, issues)

  checkRenderingNumbers(renderingObjects, issues)
  for (const row of renderingObjects) {
    const ids = new Set(
      db.actorResource
        .filter((link) => link.actorId === row.actorId && resourceIds.has(link.resourceId))
        .map((link) => link.resourceId)
    )
    const result = resolveCloudConfig(row.data?.clouds, ids)
    if (result.state !== 'invalid') continue
    for (const issue of result.issues) {
      issues.push({
        level: 'error',
        collection: 'renderingObjects',
        entity: row.actorId,
        message: `Actor ${row.actorId} clouds.${issue.path}: ${issue.message}`
      })
    }
  }


  // --- 6e. Режимы позиционирования: несочетаемые строки placements/orbits ---
  checkPositioning(db, aliasByActor, issues)

  // --- 7. Предупреждения о полноте контента ---
  const actorsWithPhysical = new Set(db.physicalObjects.map((p) => p.actorId))
  const actorsWithRendering = new Set(db.renderingObjects.map((r) => r.actorId))
  const actorsWithOrbit = new Set(db.orbits.map((o) => o.actorId))

  for (const actor of db.actors) {
    const alias = aliasByActor.get(actor.id)

    if (alias === undefined) continue // битый categoryId уже как error выше

    const { expects } = rulesFor(alias)

    if (expects.physical && !actorsWithPhysical.has(actor.id)) {
      issues.push({
        level: 'warning',
        collection: 'actors',
        entity: actor.id,
        message: `Actor ${actor.id} (${alias}) "${actor.name}" has no physicalObject`
      })
    }
    if (expects.rendering && !actorsWithRendering.has(actor.id)) {
      issues.push({
        level: 'warning',
        collection: 'actors',
        entity: actor.id,
        message: `Actor ${actor.id} (${alias}) "${actor.name}" has no renderingObject`
      })
    }
    if (expects.orbit && !actorsWithOrbit.has(actor.id)) {
      issues.push({
        level: 'warning',
        collection: 'actors',
        entity: actor.id,
        message: `Actor ${actor.id} (${alias}) "${actor.name}" has no orbit`
      })
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
