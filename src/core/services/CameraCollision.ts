import { Matrix4, Object3D, PerspectiveCamera, Ray, Sphere, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { SceneObserver } from '@/core/services/SceneObserver'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { CLEARANCE_MARGIN_METERS, terrainHeightFieldFor, type TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'
import { heightPathOf } from '@/core/terrain/heightPath'
import { readWaterLevelMeters } from '@/core/terrain/waterLevel'
import { midbandParamsOf } from '@/core/terrain/midbandParams'

export type Collider = {
  object: Object3D
  radius: number
  heightField?: TerrainHeightField
  /**
   * Уровень воды тела, метры (Task 5, water-foundation). Ручка актора
   * (`renderingObject.data.waterLevelMeters`), не поля высот — поле делится
   * по (карта, радиус) в `terrainHeightFieldFor` и уровня не знает (см. её
   * докблок). Отсутствие ручки — воды нет, все три слоя коллизии (пуш-аут,
   * поточечный марч, внешний консервативный марч по сетке клиренса) остаются
   * бит-в-бит прежними (см. `withWaterFloor`).
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
            // широкая фаза: поверхность+клиренс нигде не выше maxH+maxClearance —
            // без ручки выражение бит-в-бит прежнее (heightField.maxMeters
            // напрямую, без Math.max), с ручкой maxH заменяется на
            // max(maxH, уровень) — на случай, если уровень воды когда-нибудь
            // превысит максимум карты (гипотетическое глобальное море выше
            // самой высокой точки рельефа)
            radius: toThreeJSUnits(
              radius +
                (waterLevelMeters === undefined ? heightField.maxMeters : Math.max(heightField.maxMeters, waterLevelMeters)) /
                  1000 +
                heightField.maxClearanceMeters / 1000
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
 * Бюджет доуточнения контакта по поточечной поверхности (см. докблок
 * `marchPointwise`) — заметно меньше внешнего: искомый зазор ограничен
 * клиренсом сетки В ЭТОЙ ТОЧКЕ (сотни метров, не половина системы —
 * быстрые перелёты уже отработаны внешней консервативной фазой).
 */
const REFINE_MARCH_BUDGET = 24

/**
 * Кламп cos(широты) снизу в локальном бонде уклона sag-поля (marchPointwise):
 * у самого полюса cosLat→0, без клампа бонд ушёл бы в бесконечность и шаг
 * марча схлопнулся бы в ноль.
 */
const MIN_MARCH_COS_LAT = 1e-3

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
 * Терраформный контакт двухфазный по РАССТОЯНИЮ, не по этапу обработки (см.
 * докблок `TerrainHeightField`): широкая фаза (`collectColliders`) — всегда
 * консервативная сфера (R+maxH+maxClearance). Внутри неё `marchTerrain`
 * дальше выбирает поверхность ПО МЕСТУ вдоль свипа: снаружи консервативной
 * оболочки сетки провиса — марч против неё (гарантия отсутствия туннеля на
 * быстром пролёте, сетка размазывает пиковый провис по ячейке+дилатации и
 * потому дороже честной, но дёшева и безопасна для больших скачков); как
 * только отрезок ВОШЁЛ в эту оболочку (стартовал внутри или пересёк её по
 * пути) — марч продолжает против честной поточечной поверхности
 * (`TerrainHeightField.sagMeters`, `marchPointwise`), потому что оболочка —
 * штатная рабочая высота камеры (медиана на Луне ~236 м после сетки против
 * ~40 м честно поточечно), а не редкий крайний случай: пропускать её маршем
 * целиком открывает туннель на низких быстрых пролётах. `pushOutTerrain` —
 * та же поточечная цель (см. `pointwiseFloorRadiusUnits`).
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
  // доуточнение контакта по поточечной поверхности (см. marchPointwise) — свой
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

  /**
   * Переносит начало следующего свипа вместе с сопутствующей системой отсчёта.
   * Нужен позиционному слежению: орбитальный скачок цели (особенно на time warp)
   * не должен считаться ручным прямолинейным пролётом камеры через полсистемы.
   */
  public translateReferenceFrame(displacement: Vector3): void {
    this.lastPosition?.add(displacement)
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
   * Консервативный сферический марч в теле-фиксированном фрейме:
   * f(p) = |p| − (R + h(p̂) + clearance(p̂)); липшицева константа шага —
   * SLOPE_RANGE (допущение о крутизне DEM: слоуп-карта клампится энкодером,
   * сама карта высот — нет; у полюсов равнопрямоугольная сетка нарушает его
   * в ~3-км шапке, страхует пуш-аут) ПЛЮС локальный бонд клиренс-сетки:
   * её E-W градиент растёт как 1/cos(широты) (ячейка сетки сжимается по
   * дуге), maxClearance/дуга_ячейки откалиброван по экватору, и без поправки
   * шаг с ~65° широты перепрыгивал бы клиренс-стенку (на 89° недооценка в
   * 16 раз — окно туннеля на приполярном пролёте). Та же схема, что у
   * sag-бонда `marchPointwise` ниже. Шаг f/(1+L) не перепрыгивает
   * поверхность. Бюджет исчерпан — контакт в текущей точке помечается
   * `exhausted`: sweep() ставит камеру туда без скольжения (перестраховка
   * вместо туннеля через то, что марч не успел домаршировать). Истинный
   * контакт (не exhausted) доуточняется `marchPointwise` против честной
   * поточечной поверхности — см. её докблок и класса.
   *
   * Старт УЖЕ внутри консервативной оболочки (`distance(from) <= 0`) — эта
   * оболочка штатная рабочая высота камеры (честный пол по sagMeters ~40 м
   * медианно при оболочке сетки ~236 м), не редкий крайний случай: пропуск
   * марча целиком (отдать одному пуш-ауту) ОТКРЫВАЕТ ТУННЕЛЬ на быстром
   * тангенциальном пролёте низко над рельефом (пуш-аут ловит только
   * СТАРТОВУЮ точку, не путь между from и to). Поэтому вместо пропуска —
   * марч сразу в поточечном режиме на полный внешний бюджет, см.
   * `marchPointwise`.
   *
   * Уровень воды (Task 5) клампится ЗДЕСЬ, в потребителе `collisionRadiusUnits`
   * (сетки клиренса), а не в самом поле: сетка без клампа консервативна для
   * полётов НАД водой (никогда не занижает клиренс рельефа), но контакт/марч
   * обязаны видеть, что вода ПОДНИМАЕТ пол там, где рельеф ниже уровня —
   * `withWaterFloor` берёт max(...), то есть только увеличивает цель, не
   * нарушая консервативности сетки снизу.
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
    const waterLevelMeters = collider.waterLevelMeters
    const distance = (p: Vector3): number => {
      const r = p.length()
      if (r === 0) {
        return -withWaterFloor(field.collisionRadiusUnits(this.localDir.set(0, 0, 1)), field, waterLevelMeters)
      }
      return r - withWaterFloor(field.collisionRadiusUnits(this.localDir.copy(p).divideScalar(r)), field, waterLevelMeters)
    }

    if (distance(from) <= 0) {
      // старт внутри оболочки: марч ОБЯЗАН идти против честной поточечной
      // поверхности с самого начала (полный бюджет — сегмент может быть
      // длинным). Бюджет исчерпан здесь помечается exhausted:true — риск тот
      // же, что и у внешнего марча (потенциально длинный/быстрый отрезок,
      // не короткий гарантированный довесок, как во второй ветке ниже)
      return this.marchPointwise(collider, field, from, 0, step, length, epsilon, SWEEP_MARCH_BUDGET, true)
    }

    // экваториальный коэффициент бонда клиренс-сетки — per-body константа,
    // локальная поправка на 1/cosLat считается ниже на каждом шаге (см. докблок)
    const clearanceBond =
      field.clearanceCellEquatorArcMeters > 0 ? field.maxClearanceMeters / field.clearanceCellEquatorArcMeters : 0

    let s = 0
    const p = this.marchPoint.copy(from)
    for (let i = 0; i < SWEEP_MARCH_BUDGET; i++) {
      const d = distance(p)
      if (d <= epsilon) {
        // консервативный контакт найден извне — довесок короткий (зазор ≤
        // клиренс сетки в этой точке), exhausted:false безопасен
        return this.marchPointwise(collider, field, p, s, step, length, epsilon, REFINE_MARCH_BUDGET, false)
      }

      // localDir уже несёт p̂ после distance(p) (ветка r=0 отдаёт полюс — там
      // cosLat и так клампится снизу)
      const cosLat = Math.sqrt(Math.max(0, 1 - this.localDir.y * this.localDir.y))
      s += d / (1 + SLOPE_RANGE + clearanceBond / Math.max(cosLat, MIN_MARCH_COS_LAT))
      if (s >= length) return null
      p.copy(from).addScaledVector(step, s)
    }

    // бюджет исчерпан — консервативный контакт в текущей точке, без доуточнения:
    // перестраховка march'а важнее точности пола в этом редком случае
    return this.buildHit(collider, field, p, s, length, true)
  }

  /**
   * Марч против ЧЕСТНОЙ поточечной поверхности R+h+sag+margin — общий для
   * двух вызовов из `marchTerrain`: (а) короткое доуточнение после
   * консервативного контакта (сетка провиса систематически завышает клиренс
   * — MAX-агрегация по ячейке + дилатация, медиана по Луне ~236 м после
   * сетки против ~40 м честно поточечно, см. докблок TerrainHeightField), (б)
   * полный марч, когда старт уже внутри консервативной оболочки (см. докблок
   * `marchTerrain`).
   *
   * Липшицева константа шага: SLOPE_RANGE (уклон DEM, как и у внешнего
   * марча) ПЛЮС ЛОКАЛЬНЫЙ бонд уклона sag-поля, пересчитываемый на каждом
   * шаге из текущего направления p̂ (НЕ глобальная константа): sag-поле
   * масштабирует восток-западный градиент как 1/cos(широты) —
   * `field.maxSagMeters/field.equatorTexelMeters` откалиброван по
   * ЭКВАТОРИАЛЬНОМУ текселю, и без локальной поправки на 70° широты недооценил
   * бы уклон втрое (шаг марча мог бы перепрыгнуть честный пол — туннель у
   * полюса). cosLat берётся из p̂.y тем же способом, что и в TerrainHeightField
   * (sqrt(1−y²)), и клампится снизу — иначе у самого полюса бонд ушёл бы в
   * бесконечность. Шаг d/(1+L) соответственно короче, чем у внешнего марча —
   * при том же бюджете (SWEEP_MARCH_BUDGET=64 в режиме (б)) это означает
   * МЕНЬШИЙ гарантированный радиус сходимости за проход, но зазор здесь тоже
   * меньше на тот же множитель (искомая поверхность — честный пол, а не
   * консервативная оболочка): для типичных скоростей камеры у поверхности
   * (низкий пилотируемый пролёт, не варп) 64 шагов с запасом хватает —
   * подтверждено замером на реальной карте (см. хендофф). У самого полюса
   * локальный бонд растёт, шаг сжимается, и бюджет может исчерпаться раньше —
   * штатный жёсткий стоп (`exhausted`), не туннель. `hardStopOnExhaustion` —
   * true для режима (б) (потенциально длинный/быстрый отрезок, риск как у
   * внешнего марча), false для режима (а) (короткий гарантированный довесок,
   * сходимость должна была хватить).
   */
  private marchPointwise(
    collider: Collider,
    field: TerrainHeightField,
    startP: Vector3,
    startS: number,
    step: Vector3,
    length: number,
    epsilon: number,
    budget: number,
    hardStopOnExhaustion: boolean
  ): SweepHit | null {
    // экваториальный коэффициент бонда sag-поля — per-body константа, локальная
    // поправка на 1/cosLat считается ниже на каждом шаге из текущего p̂
    const equatorSagBond = field.equatorTexelMeters > 0 ? field.maxSagMeters / field.equatorTexelMeters : 0

    let s = startS
    const p = this.refinePoint.copy(startP)
    for (let i = 0; i < budget; i++) {
      const r = p.length()
      const dir = r === 0 ? this.localDir.set(0, 0, 1) : this.localDir.copy(p).divideScalar(r)
      const d = r - pointwiseFloorRadiusUnits(field, dir, collider.waterLevelMeters)
      if (d <= epsilon) return this.buildHit(collider, field, p, s, length, false)

      const cosLat = Math.sqrt(Math.max(0, 1 - dir.y * dir.y))
      const localSlopeBond = SLOPE_RANGE + equatorSagBond / Math.max(cosLat, MIN_MARCH_COS_LAT)

      s += d / (1 + localSlopeBond)
      if (s >= length) return null // честный пол не встречен в пределах отрезка

      p.copy(startP).addScaledVector(step, s - startS)
    }

    return this.buildHit(collider, field, p, s, length, hardStopOnExhaustion)
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
   * (см. докблок класса и `marchPointwise`) буквально каждый кадр рядом с
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
 * `marchPointwise` (доуточнение свипа) и `pushOutTerrain` — единственное
 * место, где формула контакта у поверхности собрана, не дублируется.
 */
function pointwiseFloorRadiusUnits(field: TerrainHeightField, dir: Vector3, waterLevelMeters: number | undefined): number {
  const terrainFloor = field.surfaceRadiusUnits(dir) + toThreeJSUnits((field.sagMeters(dir) + CLEARANCE_MARGIN_METERS) / 1000)
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
 * Безопасность марча (`marchTerrain`/`marchPointwise`) после клампа доказывает
 * ЛИПШИЦЕВОСТЬ, а не просто «консервативность» сама по себе (уточнение ревью
 * Task 5, фикс-раунд 1): max(f, const) липшицева с ТОЙ ЖЕ константой L, что
 * и f — константная функция 0-липшицева, максимум двух L-липшицевых функций
 * снова L-липшицев. Шаг march'а d/(1+L) безопасен для ЛЮБОЙ L-липшицевой
 * цели (это и есть всё допущение алгоритма, см. докблоки `marchTerrain`/
 * `marchPointwise`), поэтому клампнутая max(...)-цель наследует ту же
 * гарантию «шаг не перепрыгивает пол» без пересчёта константы уклона.
 */
function withWaterFloor(floorRadiusUnits: number, field: TerrainHeightField, waterLevelMeters: number | undefined): number {
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
  const terrainFloor = field.surfaceRadiusUnits(dir) + toThreeJSUnits((field.sagMeters(dir) + CLEARANCE_MARGIN_METERS) / 1000)
  return waterFloorRadiusUnits(field, waterLevelMeters) >= terrainFloor
}

export { CameraCollision }
