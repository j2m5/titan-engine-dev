import { Matrix4, Object3D, PerspectiveCamera, Ray, Sphere, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { SceneObserver } from '@/core/services/SceneObserver'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { terrainHeightFieldFor, type TerrainHeightField } from '@/core/terrain/TerrainHeightField'

export type Collider = {
  object: Object3D
  radius: number
  heightField?: TerrainHeightField
}

/** Минимальная дистанция камеры до центра тела = R × COLLISION_GAP: зазор — задел под будущий рельеф поверхностей. */
export const COLLISION_GAP = 1.001

/**
 * Сферы-коллайдеры из снапшота наблюдаемых тел.
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

/** Микроотступ от точки контакта вдоль нормали — защита от повторного захвата той же сферы float-погрешностью. */
const CONTACT_EPSILON = 1e-6

/**
 * Коллизии камеры со сферическими телами.
 *
 * Работает одной точкой кадра — после обновления позиций тел, до рендера:
 * сервису безразлично, кто сдвинул камеру (полёт, орбитальный телепорт,
 * твин перелёта) или тело (эпоха при варпе) — он видит итог и правит его.
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
  private readonly contact: Vector3 = new Vector3()
  private readonly point: Vector3 = new Vector3()
  private readonly remainder: Vector3 = new Vector3()

  private readonly inverseMatrix = new Matrix4()
  private readonly localPoint = new Vector3()
  private readonly localDir = new Vector3()

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
   * Свип отрезка «где камера была → где оказалась» против сфер тел: точечная
   * проверка туннелирует — на максимальной скорости камера проходит за кадр
   * на порядки больше диаметра Земли. При пересечении камера ставится в точку
   * контакта, нормальная составляющая остатка гасится, касательная
   * сохраняется — скольжение, а не прилипание.
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

      hit.object.getWorldPosition(this.center)
      this.normal.copy(this.contact).sub(this.center).normalize()

      this.origin.copy(this.contact).addScaledVector(this.normal, CONTACT_EPSILON)
      this.remainder.copy(position).sub(this.contact).projectOnPlane(this.normal)
      position.copy(this.origin).add(this.remainder)
    }
  }

  /**
   * Ближайшее по ходу луча пересечение в пределах отрезка. Тело, внутри
   * которого отрезок начинается, пропускается — его разрулит пуш-аут, иначе
   * скольжение размазало бы камеру по внутренней стороне сферы.
   */
  private findNearestHit(maxDistance: number): Collider | null {
    let nearest: Collider | null = null
    let nearestDistance = maxDistance

    for (const collider of this.colliders) {
      collider.object.getWorldPosition(this.sphere.center)
      this.sphere.radius = collider.radius

      if (this.sphere.containsPoint(this.ray.origin)) continue
      if (!this.ray.intersectSphere(this.sphere, this.point)) continue

      const distance = this.ray.origin.distanceTo(this.point)
      if (distance > nearestDistance) continue

      nearestDistance = distance
      nearest = collider
      this.contact.copy(this.point)
    }

    return nearest
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
   * зависит от направления в локальных осях меша. Вынос радиальный на
   * R+h(dir̂)+clearance(dir̂).
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

    const target = field.collisionRadiusUnits(this.localDir)
    if (r >= target) return false

    this.localPoint.copy(this.localDir).multiplyScalar(target).applyMatrix4(collider.object.matrixWorld)
    position.copy(this.localPoint)

    return true
  }
}

export { CameraCollision }
