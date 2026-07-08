import { EventEmitter } from '@/core/framework/EventEmitter'
import { clamp } from 'three/src/math/MathUtils'

/**
 * Владелец скорости свободного полёта камеры. Логика клампа и шага
 * колеса перенесена из cameraStore 1:1; стор теперь зеркалит speed.
 */
class CameraController extends EventEmitter {
  public readonly minSpeed: number = 10
  public readonly maxSpeed: number = 150000000 * 30

  private _speed: number = 100000

  public get speed(): number {
    return this._speed
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
}

export { CameraController }
