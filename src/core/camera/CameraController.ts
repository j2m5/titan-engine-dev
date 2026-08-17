import { EventEmitter } from '@/core/framework/EventEmitter'
import { Object3D, Vector3 } from 'three'
import { clamp } from 'three/src/math/MathUtils'

export type CameraFollowUpdate = {
  displacement: Vector3
  targetPosition: Vector3
}

/**
 * Владелец скорости свободного полёта камеры. Логика клампа и шага
 * колеса перенесена из cameraStore 1:1; стор теперь зеркалит speed.
 */
class CameraController extends EventEmitter<{ change: [] }> {
  public readonly minSpeed: number = 10
  public readonly maxSpeed: number = 150000000 * 30

  private _speed: number = 100000
  private _followTarget: Object3D | null = null

  private readonly previousFollowPosition: Vector3 = new Vector3()
  private readonly followPosition: Vector3 = new Vector3()
  private readonly followDisplacement: Vector3 = new Vector3()
  private readonly followUpdate: CameraFollowUpdate = {
    displacement: this.followDisplacement,
    targetPosition: this.followPosition
  }

  public get speed(): number {
    return this._speed
  }

  public get followTarget(): Object3D | null {
    return this._followTarget
  }

  /** Прямая установка скорости — без клампа (паритет со старым cameraStore.setSpeed) */
  public setSpeed(value: number): void {
    this._speed = value
    this.emit('change')
  }

  /** Шаг колеса мыши: deltaY<0 — ускорение, иначе замедление; с клампом */
  public adjust(deltaY: number): void {
    const factor: number = deltaY < 0 ? 1.1 : 0.9
    this._speed = clamp(this._speed * factor, this.minSpeed, this.maxSpeed)
    this.emit('change')
  }

  /**
   * Назначает объект позиционного слежения без скачка камеры: первая дельта
   * считается от мировой позиции цели в момент назначения.
   */
  public setFollowTarget(target: Object3D | null): void {
    if (this._followTarget === target) return

    this._followTarget = target

    if (target) {
      target.getWorldPosition(this.previousFollowPosition)
      this.followPosition.copy(this.previousFollowPosition)
    }

    this.followDisplacement.set(0, 0, 0)
    this.emit('change')
  }

  /** Повторный выбор активной цели отключает слежение, другая цель переключает его напрямую. */
  public toggleFollow(target: Object3D): void {
    this.setFollowTarget(this._followTarget === target ? null : target)
  }

  public stopFollowing(): void {
    this.setFollowTarget(null)
  }

  /**
   * После обновления сцены переносит камеру на мировую дельту цели. Поворот
   * камеры намеренно не меняется: это позиционное, а не body-fixed слежение.
   * Возвращаемые векторы принадлежат контроллеру и переиспользуются между кадрами.
   */
  public updateFollow(cameraPosition: Vector3): CameraFollowUpdate | null {
    if (!this._followTarget) return null

    this._followTarget.getWorldPosition(this.followPosition)
    this.followDisplacement.subVectors(this.followPosition, this.previousFollowPosition)
    cameraPosition.add(this.followDisplacement)
    this.previousFollowPosition.copy(this.followPosition)

    return this.followUpdate
  }
}

export { CameraController }
