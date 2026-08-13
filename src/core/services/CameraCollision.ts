import { Object3D, PerspectiveCamera, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { SceneObserver } from '@/core/services/SceneObserver'

export type Collider = {
  object: Object3D
  radius: number
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

    seen.add(model)
    colliders.push({ object, radius: toThreeJSUnits(radius) * COLLISION_GAP })
  }

  return colliders
}

/** Итераций пуш-аута: выталкивание из луны могло затолкнуть в планету. */
const PUSHOUT_ITERATIONS = 2

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
   * Страховка поверх свипа: тело наехало на камеру, старт внутри сферы,
   * нулевой отрезок. Мировая позиция тела — каждый кадр свежая: узлы вложены
   * (луна — ребёнок узла планеты), локальной позиции недостаточно.
   */
  private pushOut(position: Vector3): void {
    for (let iteration = 0; iteration < PUSHOUT_ITERATIONS; iteration++) {
      let moved = false

      for (const collider of this.colliders) {
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
}

export { CameraCollision }
