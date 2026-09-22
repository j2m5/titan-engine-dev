import { Vector3 } from 'three'

/**
 * Плавающее начало локальной системы камней: квантовано по сетке cellSize в
 * плоскости XZ вокруг камеры. Матрицы инстансов хранятся относительно него и
 * остаются малыми на любом радиусе — float32 буфера инстансов не теряет камни.
 */
class FloatingOrigin {
  public readonly origin: Vector3 = new Vector3()
  private readonly shift: Vector3 = new Vector3()

  public constructor(private readonly cellSize: number) {}

  /** Сдвиг начала, если камера ушла из текущей ячейки; иначе null */
  public update(cameraLocal: Vector3): Vector3 | null {
    const qx: number = Math.round(cameraLocal.x / this.cellSize) * this.cellSize
    const qz: number = Math.round(cameraLocal.z / this.cellSize) * this.cellSize

    if (qx === this.origin.x && qz === this.origin.z) return null

    this.shift.set(qx - this.origin.x, 0, qz - this.origin.z)
    this.origin.set(qx, 0, qz)

    return this.shift
  }
}

export { FloatingOrigin }
