import type { Matrix4, Vector3 } from 'three'
import type { SectorManager } from './SectorManager'

/**
 * Список каскадов заселения над одним пулом. Каскад — это SectorManager со
 * своей сеткой, генератором и порогами: у каждого класса размеров свой шаг
 * ячейки и свой радиус, поэтому сетки разные, а буфер инстансов общий.
 *
 * Кольцо — набор из одного каскада: порядок вызовов и побочных эффектов
 * совпадает с прежним прямым обращением к менеджеру.
 */
class CascadeSet {
  private readonly managers: SectorManager[]

  public constructor(managers: SectorManager[]) {
    this.managers = managers
  }

  /** Первый каскад — точка доступа тестов к внутренностям одиночного менеджера кольца */
  public get first(): SectorManager {
    return this.managers[0]
  }

  public update(
    cameraAngle: number,
    cameraRadius: number,
    cameraY: number,
    viewProjectionMatrix: Matrix4,
    localToWorldMatrix: Matrix4,
    delta: number
  ): void {
    for (const manager of this.managers) {
      manager.update(cameraAngle, cameraRadius, cameraY, viewProjectionMatrix, localToWorldMatrix, delta)
    }
  }

  public rebaseOrigins(shift: Vector3): void {
    for (const manager of this.managers) manager.rebaseOrigins(shift)
  }

  public deactivateAll(): void {
    for (const manager of this.managers) manager.deactivateAll()
  }

  public get activeCount(): number {
    return this.managers.reduce((sum, manager) => sum + manager.activeCount, 0)
  }

  public getDebugInfo(): {
    perCascade: Array<ReturnType<SectorManager['getDebugInfo']>>
    activeSectors: number
  } {
    const perCascade = this.managers.map((manager) => manager.getDebugInfo())

    return { perCascade, activeSectors: perCascade.reduce((sum, info) => sum + info.activeSectors, 0) }
  }
}

export { CascadeSet }
