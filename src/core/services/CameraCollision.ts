import { Matrix4, Object3D, PerspectiveCamera, Ray, Sphere, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { SceneObserver } from '@/core/services/SceneObserver'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { CLEARANCE_MARGIN_METERS, terrainHeightFieldFor, type TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'

export type Collider = {
  object: Object3D
  radius: number
  heightField?: TerrainHeightField
}

/**
 * Минимальная дистанция камеры до центра тела = R × COLLISION_GAP. Зазор для
 * тел БЕЗ карты высот (сфера — вся коллизия, какая для них есть); терраформные
 * тела зовут свой локальный `clearance(dir̂)` из TerrainHeightField, GAP их не касается.
 */
export const COLLISION_GAP = 1.001

/**
 * Коллайдеры из снапшота наблюдаемых тел: сферы (`R × GAP`) или, если у тела
 * есть карта высот, терраформный `heightField` (широкая фаза — сфера
 * `R + maxH + maxClearance`, узкая — рельеф, см. `marchTerrain`/`pushOutTerrain`).
 *
 * Чёрная дыра пропускается намеренно (решение владельца — объект уникальный,
 * коллизии для него отложены). Тело без модели или радиуса — молча: в кэш не
 * попадает то, для чего сферу построить не из чего. Дубли одного актора
 * (LOD-уровни и импостор находятся поиском по userData.type и делят модель)
 * схлопываются, иначе одно тело выталкивало бы камеру дважды.
 */
export function collectColliders(objects: Object3D[]): Collider[] {
  const colliders: Collider[] = []
  const seen = new Set<object>()

  for (const object of objects) {
    if (object.userData.type === 'blackHole') continue

    const model = object.model
    if (!model) continue
    if (seen.has(model)) continue

    const radius = model.physicalObject?.getAttribute('radius')
    if (typeof radius !== 'number' || radius <= 0) continue

    // Рельеф — по фактически загруженной карте (реестр Planet'а): провал загрузки
    // деградирует к сфере согласованно с геометрией и материалом
    const heightPath = model.resources?.where('resourceType', 'height').first()?.getAttribute('path')
    const map = typeof heightPath === 'string' ? heightFieldStorage.get(heightPath) : undefined
    const heightField = map ? terrainHeightFieldFor(map, radius) : undefined

    seen.add(model)
    colliders.push(
      heightField
        ? {
            object,
            // широкая фаза: поверхность+клиренс нигде не выше maxH+maxClearance
            radius: toThreeJSUnits(radius + heightField.maxMeters / 1000 + heightField.maxClearanceMeters / 1000),
            heightField
          }
        : { object, radius: toThreeJSUnits(radius) * COLLISION_GAP }
    )
  }

  return colliders
}

/** Итераций пуш-аута: выталкивание из луны могло затолкнуть в планету. */
const PUSHOUT_ITERATIONS = 2

/** Итераций свип+скольжение: скольжение могло врезать камеру в кривизну той же сферы или в соседнее тело. */
const SWEEP_ITERATIONS = 3

/**
 * Доля радиуса широкой фазы тела — микроотступ от контакта вдоль нормали,
 * защита от повторного захвата той же поверхности float-погрешностью.
 * Абсолютные юниты на масштабе системы (парсеки) упирались во float32.
 * Радиус локальный (в вершинах меша), сдвиг применяется вдоль мировой
 * нормали — для терраформных тел это эквивалентно только при scale=1 (радиус
 * запечён в вершины, глобального множителя меша нет).
 */
const RELATIVE_CONTACT_EPSILON = 1e-6

/** Бюджет консервативного марча по рельефу; исчерпание — контакт, не туннель. */
const SWEEP_MARCH_BUDGET = 64

/**
 * Бюджет доуточнения контакта по поточечной поверхности (см. докблок
 * `refineContact`) — заметно меньше внешнего: искомый зазор ограничен
 * клиренсом сетки В ЭТОЙ ТОЧКЕ (сотни метров, не половина системы —
 * быстрые перелёты уже отработаны внешней консервативной фазой).
 */
const REFINE_MARCH_BUDGET = 24

/**
 * Единый формат хита свипа: сфера и терраформный марч отдают одно и то же.
 * `exhausted` ставит только терраформный марч (сферы контакт находят точно,
 * бюджета у них нет) — сигнал sweep() применить жёсткий стоп без скольжения.
 */
type SweepHit = {
  collider: Collider
  t: number // доля пройденного отрезка (0..1] — сравнима между телами
  contact: Vector3 // мировой контакт (собственный скретч хита не нужен — один активный)
  normal: Vector3 // мировая нормаль контакта
  exhausted: boolean // бюджет марча исчерпан до истинного контакта — перестраховка, не скольжение
}

/**
 * Коллизии камеры со сферическими и терраформными (рельефными) телами.
 *
 * Работает одной точкой кадра — после обновления позиций тел, до рендера:
 * сервису безразлично, кто сдвинул камеру (полёт, орбитальный телепорт,
 * твин перелёта) или тело (эпоха при варпе) — он видит итог и правит его.
 *
 * Терраформный контакт двухфазный (раунд 2 фикса карты провиса,
 * `TerrainHeightField`): широкая фаза (`collectColliders`) и внешний марч
 * (`marchTerrain`) работают против намеренно консервативной сетки провиса
 * — гарантия отсутствия туннеля на быстром свипе. Найденный ей контакт
 * систематически ВЫШЕ честного пола (сетка размазывает пиковый провис по
 * ячейке+дилатации, медиана на Луне ~236 м после сетки против ~28–40 м
 * поточечно) — `refineContact` доуточняет его коротким довеском марча по
 * честной поточечной поверхности (`TerrainHeightField.sagMeters`), а
 * `pushOutTerrain` целится сразу в неё же (см. `pointwiseFloorRadiusUnits`).
 */
class CameraCollision {
  private lastPosition: Vector3 | null = null
  private colliders: Collider[] = []
  private snapshot: Object3D[] | null = null

  private readonly center: Vector3 = new Vector3()
  private readonly normal: Vector3 = new Vector3()

  private readonly ray: Ray = new Ray()
  private readonly sphere: Sphere = new Sphere()
  private readonly origin: Vector3 = new Vector3()
  private readonly point: Vector3 = new Vector3()
  private readonly remainder: Vector3 = new Vector3()

  private readonly inverseMatrix = new Matrix4()
  private readonly localPoint = new Vector3()
  private readonly localDir = new Vector3()

  // терраформный марч свипа: единый локальный отрезок для каждого кандидата-тела
  private readonly marchFrom = new Vector3()
  private readonly marchTo = new Vector3()
  private readonly marchStep = new Vector3()
  private readonly marchPoint = new Vector3()
  // доуточнение контакта по поточечной поверхности (см. refineContact) — свой
  // скретч точки, marchPoint уже занят консервативной точкой на момент вызова
  private readonly refinePoint = new Vector3()

  // скретчи текущего кандидата хита findNearestHit (перезаписываются на каждой
  // проверяемой сфере/теле) и best-скретчи лучшего кандидата — раздельные,
  // иначе второй терраформный кандидат затирает контакт первого до сравнения
  private readonly hitContact = new Vector3()
  private readonly hitNormal = new Vector3()
  private readonly bestContact = new Vector3()
  private readonly bestNormal = new Vector3()

  public constructor(
    private camera: PerspectiveCamera,
    private sceneObserver: SceneObserver
  ) {}

  /**
   * Сброс после легального телепорта (дефолтная позиция сценария): без него
   * свип протянул бы отрезок от старой позиции через полсистемы и мог бы
   * ложно поймать тело по пути.
   */
  public reset(): void {
    this.lastPosition = null
  }

  public resolve(): void {
    this.refreshColliders()

    const position = this.camera.position

    if (this.lastPosition === null) {
      this.lastPosition = position.clone()
    } else {
      this.sweep(this.lastPosition, position)
    }

    this.pushOut(position)
    this.lastPosition.copy(position)
  }

  /**
   * Кэш перестраивается по смене ссылки: SceneObserver пересоздаёт `objects`
   * новым массивом при установке сцены и в dispose.
   */
  private refreshColliders(): void {
    if (this.snapshot === this.sceneObserver.objects) return

    this.snapshot = this.sceneObserver.objects
    this.colliders = collectColliders(this.snapshot)
  }

  /**
   * Свип отрезка «где камера была → где оказалась» против тел (сфер и
   * рельефа): точечная проверка туннелирует — на максимальной скорости
   * камера проходит за кадр на порядки больше диаметра Земли. При
   * пересечении камера ставится в точку контакта, нормальная составляющая
   * остатка гасится, касательная сохраняется — скольжение, а не прилипание.
   *
   * Исключение — исчерпание бюджета марча (`exhausted`): последняя безопасная
   * точка march'а не гарантированно на самой поверхности (перестраховка), а
   * скольжение по её нормали протянуло бы остаток отрезка ДАЛЬШЕ и рисковало
   * бы туннелем сквозь то, что марч не успел домаршировать. Камера ставится
   * в эту точку без сдвига по нормали и без остатка, итерации не продолжаются.
   */
  private sweep(from: Vector3, position: Vector3): void {
    this.origin.copy(from)

    for (let iteration = 0; iteration < SWEEP_ITERATIONS; iteration++) {
      const length = this.origin.distanceTo(position)
      if (length === 0) return

      this.ray.origin.copy(this.origin)
      this.ray.direction.copy(position).sub(this.origin).divideScalar(length)

      const hit = this.findNearestHit(length)
      if (!hit) return

      if (hit.exhausted) {
        position.copy(hit.contact)
        return
      }

      const epsilon = hit.collider.radius * RELATIVE_CONTACT_EPSILON
      this.origin.copy(hit.contact).addScaledVector(hit.normal, epsilon)
      this.remainder.copy(position).sub(hit.contact).projectOnPlane(hit.normal)
      position.copy(this.origin).add(this.remainder)
    }
  }

  /**
   * Ближайшее по ходу луча пересечение в пределах отрезка — по всем телам
   * разом, сферическим и терраформным (сравнение по общей доле t отрезка).
   * Тело, внутри которого отрезок начинается, пропускается — его разрулит
   * пуш-аут, иначе скольжение размазало бы камеру по внутренней стороне
   * сферы. Терраформный кандидат — свой гейт внутри marchTerrain, здесь не
   * дублируется.
   */
  private findNearestHit(maxDistance: number): SweepHit | null {
    let nearest: SweepHit | null = null

    for (const collider of this.colliders) {
      let t: number
      let exhausted = false

      if (collider.heightField) {
        const hit = this.marchTerrain(collider, collider.heightField, maxDistance)
        if (!hit) continue
        t = hit.t
        exhausted = hit.exhausted
      } else {
        collider.object.getWorldPosition(this.sphere.center)
        this.sphere.radius = collider.radius

        if (this.sphere.containsPoint(this.ray.origin)) continue
        if (!this.ray.intersectSphere(this.sphere, this.point)) continue

        const distance = this.ray.origin.distanceTo(this.point)
        if (distance > maxDistance) continue

        t = distance / maxDistance
        this.hitContact.copy(this.point)
        this.hitNormal.copy(this.point).sub(this.sphere.center).normalize()
      }

      if (nearest && t >= nearest.t) continue

      nearest = {
        collider,
        t,
        contact: this.bestContact.copy(this.hitContact),
        normal: this.bestNormal.copy(this.hitNormal),
        exhausted
      }
    }

    return nearest
  }

  /**
   * Консервативный сферический марч в теле-фиксированном фрейме:
   * f(p) = |p| − (R + h(p̂) + clearance(p̂)); липшицева константа уклона —
   * SLOPE_RANGE — допущение о крутизне DEM (слоуп-карта клампится энкодером,
   * сама карта высот — нет; у полюсов равнопрямоугольная сетка нарушает его
   * в ~3-км шапке, страхует пуш-аут), шаг f/(1+L) не перепрыгивает
   * поверхность. Бюджет исчерпан — контакт в текущей точке помечается
   * `exhausted`: sweep() ставит камеру туда без скольжения (перестраховка
   * вместо туннеля через то, что марч не успел домаршировать). Истинный
   * контакт (не exhausted) доуточняется `refineContact` против честной
   * поточечной поверхности — см. её докблок и класса.
   */
  private marchTerrain(collider: Collider, field: TerrainHeightField, maxDistance: number): SweepHit | null {
    collider.object.updateWorldMatrix(true, false)
    this.inverseMatrix.copy(collider.object.matrixWorld).invert()
    // отрезок в текущем фрейме тела: свип видит только собственное движение
    // камеры за кадр; вращение тела за кадр ловит пуш-аут (страховка) —
    // неподвижная камера над вращающимся телом даёт здесь нулевой отрезок
    const from = this.marchFrom.copy(this.ray.origin).applyMatrix4(this.inverseMatrix)
    const to = this.marchTo
      .copy(this.ray.origin)
      .addScaledVector(this.ray.direction, maxDistance)
      .applyMatrix4(this.inverseMatrix)

    const length = from.distanceTo(to)
    if (length === 0) return null
    const step = this.marchStep.copy(to).sub(from).divideScalar(length)

    const epsilon = collider.radius * RELATIVE_CONTACT_EPSILON
    const distance = (p: Vector3): number => {
      const r = p.length()
      if (r === 0) return -field.collisionRadiusUnits(this.localDir.set(0, 0, 1))
      return r - field.collisionRadiusUnits(this.localDir.copy(p).divideScalar(r))
    }

    if (distance(from) <= 0) return null // старт под поверхностью — зона пуш-аута

    let s = 0
    const p = this.marchPoint.copy(from)
    for (let i = 0; i < SWEEP_MARCH_BUDGET; i++) {
      const d = distance(p)
      if (d <= epsilon) return this.refineContact(collider, field, p, s, step, length, epsilon)

      s += d / (1 + SLOPE_RANGE)
      if (s >= length) return null
      p.copy(from).addScaledVector(step, s)
    }

    // бюджет исчерпан — консервативный контакт в текущей точке, без доуточнения:
    // перестраховка march'а важнее точности пола в этом редком случае
    return this.buildHit(collider, field, p, s, length, true)
  }

  /**
   * Двухфазный контакт (раунд 2 фикса карты провиса): сетка провиса —
   * намеренно консервативный СТРАЖ (см. докблок TerrainHeightField), её
   * MAX-агрегация по ячейке + дилатация систематически завышают клиренс
   * относительно честного поточечного провиса (медиана по Луне ~28 м
   * поточечно против ~236 м после сетки) — останавливать камеру ровно на
   * консервативной поверхности значит держать её в воздухе намного выше
   * настоящего пола. Здесь — ограниченный марч ТЕМ ЖЕ шагом Липшица, но по
   * поточечной поверхности R+h+sag+margin, от точки консервативного контакта
   * до конца ОСТАВШЕГОСЯ отрезка свипа. Не туннелирует: искомый зазор ≤
   * клиренс сетки в этой точке (сотни метров максимум, не половина
   * системы — быстрые перелёты уже погашены внешней консервативной фазой
   * выше), бюджет REFINE_MARCH_BUDGET мал и рассчитан именно на такой
   * короткий довесок. Если поточечный пол не встречен до конца отрезка —
   * сетка была неверно консервативна именно здесь: возвращает null, sweep()
   * не тормозит камеру вовсе (остаток свипа продолжится в следующей
   * итерации/кадре как обычное движение).
   */
  private refineContact(
    collider: Collider,
    field: TerrainHeightField,
    conservativeP: Vector3,
    conservativeS: number,
    step: Vector3,
    length: number,
    epsilon: number
  ): SweepHit | null {
    const pointDistance = (p: Vector3): number => {
      const r = p.length()
      const dir = r === 0 ? this.localDir.set(0, 0, 1) : this.localDir.copy(p).divideScalar(r)
      return r - pointwiseFloorRadiusUnits(field, dir)
    }

    let s = conservativeS
    const p = this.refinePoint.copy(conservativeP)
    for (let i = 0; i < REFINE_MARCH_BUDGET; i++) {
      const d = pointDistance(p)
      if (d <= epsilon) return this.buildHit(collider, field, p, s, length, false)

      s += d / (1 + SLOPE_RANGE)
      if (s >= length) return null // честный пол не встречен в пределах отрезка

      p.copy(conservativeP).addScaledVector(step, s - conservativeS)
    }

    // бюджет доуточнения исчерпан (сходимость Липшица должна была хватить на
    // малый зазор) — лучшая найденная точка, без хард-стопа: она уже ближе к
    // честному полу, чем консервативная, скольжение по ней безопасно
    return this.buildHit(collider, field, p, s, length, false)
  }

  /**
   * Хит марча: нормаль из градиента карты, контакт и доля отрезка — общие
   * для обеих развязок marchTerrain (истинный контакт и исчерпание бюджета),
   * отличается только `exhausted`.
   */
  private buildHit(
    collider: Collider,
    field: TerrainHeightField,
    p: Vector3,
    s: number,
    length: number,
    exhausted: boolean
  ): SweepHit {
    const normal = this.hitNormal
    field.surfaceNormalLocal(this.localDir.copy(p).normalize(), normal)
    normal.transformDirection(collider.object.matrixWorld)

    return {
      collider,
      t: s / length,
      contact: this.hitContact.copy(p).applyMatrix4(collider.object.matrixWorld),
      normal,
      exhausted
    }
  }

  /**
   * Страховка поверх свипа: тело наехало на камеру, старт внутри сферы,
   * нулевой отрезок. Мировая позиция тела — каждый кадр свежая: узлы вложены
   * (луна — ребёнок узла планеты), локальной позиции недостаточно.
   */
  private pushOut(position: Vector3): void {
    for (let iteration = 0; iteration < PUSHOUT_ITERATIONS; iteration++) {
      let moved = false

      for (const collider of this.colliders) {
        if (collider.heightField) {
          if (this.pushOutTerrain(collider, collider.heightField, position)) moved = true
          continue
        }

        collider.object.getWorldPosition(this.center)

        if (position.distanceTo(this.center) >= collider.radius) continue

        this.normal.copy(position).sub(this.center)

        // Камера ровно в центре — наружу в произвольную сторону, лишь бы не NaN
        if (this.normal.lengthSq() === 0) this.normal.set(0, 0, 1)

        position.copy(this.center).addScaledVector(this.normal.normalize(), collider.radius)
        moved = true
      }

      if (!moved) return
    }
  }

  /**
   * Вынос из рельефа — в теле-фиксированном фрейме: тела вращаются, и высота
   * зависит от направления в локальных осях меша. Отсев «внутри ли вообще» —
   * по широкой фазе (сфера R+maxH+maxClearance, консервативная, дёшева).
   * Сама цель выноса — честная поточечная поверхность (`pointwiseFloorRadiusUnits`),
   * не сеточная: иначе пуш-аут держит камеру заметно выше настоящего пола
   * (см. докблок класса и `refineContact`) буквально каждый кадр рядом с
   * телом, а не только в момент касания.
   */
  private pushOutTerrain(collider: Collider, field: TerrainHeightField, position: Vector3): boolean {
    collider.object.updateWorldMatrix(true, false)
    this.inverseMatrix.copy(collider.object.matrixWorld).invert()
    this.localPoint.copy(position).applyMatrix4(this.inverseMatrix)

    // быстрый отсев по широкой фазе в локальном фрейме
    const r = this.localPoint.length()
    if (r >= collider.radius) return false

    if (r === 0) {
      this.localDir.set(0, 0, 1) // центр тела: наружу в произвольную сторону
    } else {
      this.localDir.copy(this.localPoint).divideScalar(r)
    }

    const target = pointwiseFloorRadiusUnits(field, this.localDir)
    if (r >= target) return false

    this.localPoint.copy(this.localDir).multiplyScalar(target).applyMatrix4(collider.object.matrixWorld)
    position.copy(this.localPoint)

    return true
  }
}

/**
 * Честная поточечная поверхность контакта, юниты three.js: R+h(dir̂)+sag(dir̂)+margin.
 * Общая для `refineContact` (доуточнение свипа) и `pushOutTerrain` — единственное
 * место, где формула контакта у поверхности собрана, не дублируется.
 */
function pointwiseFloorRadiusUnits(field: TerrainHeightField, dir: Vector3): number {
  return field.surfaceRadiusUnits(dir) + toThreeJSUnits((field.sagMeters(dir) + CLEARANCE_MARGIN_METERS) / 1000)
}

export { CameraCollision }
