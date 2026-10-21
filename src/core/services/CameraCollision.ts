import { Matrix4, Object3D, PerspectiveCamera, Ray, Sphere, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { SceneObserver } from '@/core/services/SceneObserver'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import {
  CLEARANCE_MARGIN_METERS,
  terrainHeightFieldFor,
  type TerrainHeightField
} from '@/core/terrain/TerrainHeightField'
import { heightPathOf } from '@/core/terrain/heightPath'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import { midbandParamsOf } from '@/core/terrain/midbandParams'
import { roundedFloat32UpperBound } from '@/core/terrain/terrainRange'
import type { SurfaceProbe } from '@/core/libs/surfaceCamera'

export type Collider = {
  object: Object3D
  radius: number
  heightField?: TerrainHeightField
  /**
   * Уровень воды тела, метры (Task 5, water-foundation). Ручка актора
   * (`renderingObject.data.waterLevelMeters`), не поля высот — поле делится
   * по ключу `terrainHeightFieldFor` (см. её докблок). Отсутствие ручки —
   * воды нет; свип и пуш-аут используют только рельеф (см. `withWaterFloor`).
   */
  waterLevelMeters?: number
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
    const heightPath: string | undefined = heightPathOf(model)
    const map = heightPath === undefined ? undefined : heightFieldStorage.get(heightPath)
    // одна функция чтения параметров полосы с RenderableFactory — иначе
    // кеш terrainHeightFieldFor разойдётся на два поля одной карты и
    // мешер с коллизией разъедутся (урок архива этапа 5)
    const heightField = map ? terrainHeightFieldFor(map, radius, midbandParamsOf(model)) : undefined

    // Уровень воды (Task 5) — ручка тела, не поля (см. докблок Collider);
    // считается только для терраформных тел (без рельефа воду отделять не от чего).
    // Предикат валидности единый на все три места чтения — см. readWaterLevelMeters
    const waterLevelMeters = heightField ? readWaterLevelMeters(model) : undefined

    seen.add(model)
    colliders.push(
      heightField
        ? {
            object,
            // широкая фаза: поверхность+клиренс нигде не выше maxH+maxClearance.
            // maxH = maxHeightWithMidbandMeters (Task 5, не maxMeters карты):
            // heightMeters канона уже несёт полосу (Task 4), широкая фаза обязана
            // видеть тот же потолок — иначе узкая фаза (collisionRadiusUnits)
            // могла бы выйти за пределы этой сферы на гребне полосы. С ручкой
            // воды maxH заменяется на max(maxH, уровень) — на случай, если
            // уровень воды когда-нибудь превысит максимум рельефа (гипотетическое
            // глобальное море выше самой высокой точки)
            radius: toThreeJSUnits(
              radius +
                (waterLevelMeters === undefined
                  ? heightField.maxHeightWithMidbandMeters
                  : Math.max(heightField.maxHeightWithMidbandMeters, waterLevelMeters)) /
                  1000 +
                // Два Float32-округления: pointSag, затем clearanceGrid.
                // Margin входит и в истинный пол, поэтому не заменяет этот запас.
                roundedFloat32UpperBound(heightField.maxClearanceMeters, 2) / 1000
            ),
            heightField,
            waterLevelMeters
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
 * Широкая фаза (`collectColliders`) — консервативная сфера
 * R+maxH+maxClearance. Внутри неё `marchTerrain` ограничивает высоту
 * поточечного пола на всём интервале движения и делит неопределённые
 * интервалы. Исчерпав бюджет, камера остаётся в конце проверенного
 * свободного префикса. `pushOutTerrain` использует тот же поточечный пол
 * (см. `pointwiseFloorRadiusUnits`).
 */
class CameraCollision {
  private lastPosition: Vector3 | null = null
  private colliders: Collider[] = []
  private snapshot: Object3D[] | null = null

  /** Версия реестра карт высот на момент последней пересборки коллайдеров. */
  private mapsVersion: number = -1

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
  // Второй конец проверяемого интервала; marchPoint хранит первый.
  private readonly refinePoint = new Vector3()

  // скретчи текущего кандидата хита findNearestHit (перезаписываются на каждой
  // проверяемой сфере/теле) и best-скретчи лучшего кандидата — раздельные,
  // иначе второй терраформный кандидат затирает контакт первого до сравнения
  private readonly hitContact = new Vector3()
  private readonly hitNormal = new Vector3()
  private readonly bestContact = new Vector3()
  private readonly bestNormal = new Vector3()

  private readonly probe: SurfaceProbe = { center: new Vector3(), altitude: 0, surfaceRadius: 0 }

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

  /**
   * Разборка сценария: коллайдеры и снимок держат разобранные узлы и карты
   * высот до первого кадра следующего сценария — отпускаем сразу. Следующий
   * resolve() пересоберёт кэш: снимок null не равен objects наблюдателя.
   */
  public clear(): void {
    this.colliders = []
    this.snapshot = null
    this.mapsVersion = -1
    this.lastPosition = null
  }

  /**
   * Переносит начало следующего свипа вместе с сопутствующей системой отсчёта.
   * Нужен позиционному слежению: орбитальный скачок цели (особенно на time warp)
   * не должен считаться ручным прямолинейным пролётом камеры через полсистемы.
   */
  public translateReferenceFrame(displacement: Vector3): void {
    this.lastPosition?.add(displacement)
  }

  /**
   * Ближайшая поверхность под камерой — по высоте над ней, не по расстоянию до
   * центра: малая луна у камеры важнее большой планеты дальше. Рельеф —
   * поточечно под камерой (с водой) в пределах двух радиусов широкой фазы;
   * дальше — сфера широкой фазы. Звать после resolve(): коллайдеры свежие. Объект
   * переиспользуется между вызовами.
   */
  public nearestSurface(): SurfaceProbe | null {
    const position = this.camera.position
    let best: SurfaceProbe | null = null

    for (const collider of this.colliders) {
      collider.object.getWorldPosition(this.center)
      const distance = position.distanceTo(this.center)
      let surfaceRadius = collider.radius

      if (collider.heightField && distance < 2 * collider.radius && distance > 0) {
        collider.object.updateWorldMatrix(true, false)
        this.inverseMatrix.copy(collider.object.matrixWorld).invert()
        this.localDir.copy(position).applyMatrix4(this.inverseMatrix).normalize()
        surfaceRadius = collider.heightField.surfaceRadiusUnits(this.localDir)
        if (collider.waterLevelMeters !== undefined) {
          surfaceRadius = Math.max(
            surfaceRadius,
            collider.heightField.waterSurfaceRadiusUnits(collider.waterLevelMeters)
          )
        }
      }

      const altitude = distance - surfaceRadius
      if (best !== null && altitude >= best.altitude) continue

      best = this.probe
      best.center.copy(this.center)
      best.altitude = altitude
      best.surfaceRadius = surfaceRadius
    }

    return best
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
   * Коллайдеры пересобираются при смене ссылки sceneObserver.objects ИЛИ при
   * смене состава реестра карт высот.
   *
   * Ссылка меняется не только при смене сцены: с приходом гейта карт высот её
   * пересобирает и подмена поверхности тела в рантайме
   * (HeightFieldGate.recompute → SceneObserver.refreshObservableObjects, см.
   * их докблоки) — старый снимок иначе держал бы открепленную поверхность.
   *
   * Версия реестра остаётся вторым, независимым условием: состав карт
   * меняется асинхронно и в промежутке между пересчётами гейта (карта
   * долетает раньше, чем её увидит ближайший пересчёт), а коллайдеры строятся
   * из ДАННЫХ карты, а не только из типа поверхности. До пересбора снимка на
   * свапе (Task 5 арки гейта) версия была единственным сигналом о приходе
   * карты; сейчас — дешёвая страховка от расхождения этих двух сигналов.
   */
  private refreshColliders(): void {
    if (this.snapshot === this.sceneObserver.objects && this.mapsVersion === heightFieldStorage.version) return

    this.snapshot = this.sceneObserver.objects
    this.mapsVersion = heightFieldStorage.version
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

    // Итерации кончились, а цель ПОСЛЕДНЕГО скольжения легла в position без
    // свипа. Обычно безвредно (нет контакта — вышли бы раньше), но у
    // клиренс-стенки над плоским честным рельефом нормаль хита почти
    // радиальна: каждая итерация продвигала origin лишь на ε, а непроверенный
    // остаток тащил камеру сквозь стенку (приполярный туннель, вторая половина
    // фикса локального бонда marchTerrain). Контрольный свип: контакт всё ещё
    // есть — жёсткий стоп в нём, по той же логике перестраховки, что exhausted.
    const length = this.origin.distanceTo(position)
    if (length === 0) return

    this.ray.origin.copy(this.origin)
    this.ray.direction.copy(position).sub(this.origin).divideScalar(length)

    const hit = this.findNearestHit(length)
    if (hit) position.copy(hit.contact)
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
   * Проверяем весь отрезок через верхнюю границу поточечного пола.
   * Направления прямого отрезка лежат на малой дуге; поле ограничивает
   * DEM + midband + sag на всей дуге, включая разрывы legacy-шума.
   * Если минимальный радиус выше этой границы, интервал целиком свободен.
   * Иначе делим его пополам, всегда обрабатывая левую часть первой.
   * Бюджет исчерпан — остаёмся в конце доказанно свободного префикса.
   * Здесь нет предположений о slope-текстуре или о градиенте в одной точке.
   */
  private marchTerrain(collider: Collider, field: TerrainHeightField, maxDistance: number): SweepHit | null {
    collider.object.updateWorldMatrix(true, false)
    this.inverseMatrix.copy(collider.object.matrixWorld).invert()
    const from = this.marchFrom.copy(this.ray.origin).applyMatrix4(this.inverseMatrix)
    const to = this.marchTo
      .copy(this.ray.origin)
      .addScaledVector(this.ray.direction, maxDistance)
      .applyMatrix4(this.inverseMatrix)
    const length = from.distanceTo(to)
    if (length === 0) return null
    const step = this.marchStep.copy(to).sub(from).divideScalar(length)
    const epsilon = collider.radius * RELATIVE_CONTACT_EPSILON
    const numericalGap = collider.radius * 1e-12
    const pending = [length]
    let certified = 0
    const p = this.marchPoint
    const q = this.refinePoint
    for (let work = 0; pending.length > 0 && work < SWEEP_MARCH_BUDGET; work++) {
      const end = pending.pop()!
      p.copy(from).addScaledVector(step, certified)
      q.copy(from).addScaledVector(step, end)
      const projection = Math.max(0, Math.min(end - certified, -p.dot(step)))
      const minRadius = this.localPoint.copy(p).addScaledVector(step, projection).length()
      if (minRadius > collider.radius + numericalGap) {
        certified = end
        continue
      }
      const fromRadius = p.length()
      const fromDir = fromRadius === 0 ? this.localDir.set(0, 0, 1) : this.localDir.copy(p).divideScalar(fromRadius)
      const toDir = this.normal.copy(q).normalize()
      const upper = withWaterFloor(
        field.collisionRadiusUpperBoundUnits(fromDir, toDir),
        field,
        collider.waterLevelMeters
      )
      if (minRadius > upper + numericalGap) {
        certified = end
        continue
      }
      const gap = fromRadius - pointwiseFloorRadiusUnits(field, fromDir, collider.waterLevelMeters)
      if (gap <= epsilon) {
        return this.buildHit(collider, field, p, certified, length, false)
      }
      // Узкий интервал с разрывом не обязан иметь точку с малым зазором.
      // Это неопределённость, а не разрешение скользить через остаток.
      if (end - certified <= epsilon * 1e-3) return this.buildHit(collider, field, p, certified, length, true)
      const middle = certified + (end - certified) / 2
      if (middle === certified || middle === end) return this.buildHit(collider, field, p, certified, length, true)
      pending.push(end, middle)
    }
    if (pending.length === 0) return null
    p.copy(from).addScaledVector(step, certified)
    return this.buildHit(collider, field, p, certified, length, true)
  }

  /**
   * Хит марча: нормаль из градиента карты (или радиальная над водой, см.
   * `isWaterBoundFloor` — находка №2 фикс-раунда 1), контакт и доля отрезка —
   * общие для обеих развязок marchTerrain (истинный контакт и исчерпание
   * бюджета), отличается только `exhausted`.
   */
  private buildHit(
    collider: Collider,
    field: TerrainHeightField,
    p: Vector3,
    s: number,
    length: number,
    exhausted: boolean
  ): SweepHit {
    const dir = this.localDir.copy(p).normalize()
    const normal = this.hitNormal

    if (isWaterBoundFloor(field, dir, collider.waterLevelMeters)) {
      // над водой поверхность аналитически радиальна — нормаль дна здесь
      // невидимого и не относящегося к делу рельефа заставила бы скольжение
      // нырять/подпрыгивать у берега
      normal.copy(dir)
    } else {
      field.surfaceNormalLocal(dir, normal)
    }

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
   * (см. докблок класса) буквально каждый кадр рядом с
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

    const target = pointwiseFloorRadiusUnits(field, this.localDir, collider.waterLevelMeters)
    if (r >= target) return false

    this.localPoint.copy(this.localDir).multiplyScalar(target).applyMatrix4(collider.object.matrixWorld)
    position.copy(this.localPoint)

    return true
  }
}

/**
 * Честная поточечная поверхность контакта, юниты three.js: R+h(dir̂)+sag(dir̂)+margin,
 * поднятая до уровня воды, если он выше (Task 5, water-foundation). Общая для
 * `marchTerrain` и `pushOutTerrain` — единственное
 * место, где формула контакта у поверхности собрана, не дублируется.
 */
function pointwiseFloorRadiusUnits(
  field: TerrainHeightField,
  dir: Vector3,
  waterLevelMeters: number | undefined
): number {
  const terrainFloor =
    field.surfaceRadiusUnits(dir) + toThreeJSUnits((field.sagMeters(dir) + CLEARANCE_MARGIN_METERS) / 1000)
  return withWaterFloor(terrainFloor, field, waterLevelMeters)
}

/**
 * Пол воды, юниты three.js: R+уровень+margin — тот же CLEARANCE_MARGIN_METERS,
 * что и у рельефа (пол суши — R+h+sag+margin), для симметрии: камера не
 * должна отдыхать ровно в аналитической плоскости воды, у неё нет своего
 * "sag" (плоскость идеальна), но амортизатор нужен тот же, что у любого
 * честного контакта (ревью Task 5, фикс-раунд 1, находка №5).
 */
function waterFloorRadiusUnits(field: TerrainHeightField, waterLevelMeters: number): number {
  return field.waterSurfaceRadiusUnits(waterLevelMeters) + toThreeJSUnits(CLEARANCE_MARGIN_METERS / 1000)
}

/**
 * Пол контакта, поднятый до уровня воды: max(floorRadiusUnits, R+уровень+margin).
 * Без ручки (`waterLevelMeters === undefined`) возвращает `floorRadiusUnits`
 * НЕ ТРОНУТЫМ — ни одного лишнего float-действия над ним, поведение тел без
 * воды бит-в-бит прежнее. Только max(...) — вода ПОДНИМАЕТ пол, никогда не
 * опускает: там, где рельеф уже выше уровня, эта функция — тождество.
 *
 * Если U ограничивает рельеф на всём интервале, max(U, water) ограничивает
 * и общий пол max(terrain, water). Та же функция применяется к интервалу
 * и точке; предположение о непрерывности поверхности здесь не требуется.
 */
function withWaterFloor(
  floorRadiusUnits: number,
  field: TerrainHeightField,
  waterLevelMeters: number | undefined
): number {
  if (waterLevelMeters === undefined) return floorRadiusUnits
  return Math.max(floorRadiusUnits, waterFloorRadiusUnits(field, waterLevelMeters))
}

/**
 * Связывающее ограничение контакта в направлении dir̂ — водный пол, не рельеф
 * (ревью Task 5, фикс-раунд 1, находка №2)? Тот же max(...), которым
 * `withWaterFloor` поднимает пол — здесь нужно знать, КТО победил: нормаль
 * контакта над водой обязана быть радиальной (p̂, аналитическая сфера), а не
 * взятой с дна (`surfaceNormalLocal`) — иначе скольжение камеры у берега
 * ныряет/подпрыгивает вслед за невидимым под водой рельефом. Сравнение — по
 * честной поточечной формуле (та же, что `pointwiseFloorRadiusUnits`):
 * сеточный (консервативный) пол везде ≥ поточечного, так что поточечное
 * сравнение — наименее агрессивная (наиболее консервативная в пользу
 * рельефа) оценка «чья это на самом деле поверхность», подходящая и для
 * приближённых точек контакта (marchTerrain exhausted), не только для
 * точного поточечного схождения.
 */
function isWaterBoundFloor(field: TerrainHeightField, dir: Vector3, waterLevelMeters: number | undefined): boolean {
  if (waterLevelMeters === undefined) return false
  const terrainFloor =
    field.surfaceRadiusUnits(dir) + toThreeJSUnits((field.sagMeters(dir) + CLEARANCE_MARGIN_METERS) / 1000)
  return waterFloorRadiusUnits(field, waterLevelMeters) >= terrainFloor
}

export { CameraCollision }
