import { Group, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { threeJS } from '@/core/graphic/ThreeJS'
import { SectorGrid, SectorGridConfig } from './SectorGrid'
import { AsteroidGenerator, GeneratorConfig } from './AsteroidGenerator'
import { InstancePool, PoolLayerConfig } from './InstancePool'
import { SectorManager, LODThresholds } from './SectorManager'

/**
 * Конфигурация системы астероидного кольца
 */
interface AsteroidRingConfig {
  /** Внутренний радиус кольца в реальных км */
  innerRadiusKm: number
  /** Внешний радиус кольца в реальных км */
  outerRadiusKm: number
  /** Толщина кольца в реальных км (вертикальный разброс) */
  thicknessKm: number
  /** Размер сектора в реальных км (определяет гранулярность сетки) */
  cellSizeKm: number
  /** Базовая плотность экземпляров на единицу площади (Three.js units²) */
  densityPerUnit: number
  /** ID кольца для генерации seed'ов (должен быть уникальным для каждого кольца) */
  ringId: number
  /** Размер геометрии отдельного астероида (радиус IcosahedronGeometry в реальных км) */
  asteroidSizeKm: number
  /** Минимальный масштаб экземпляра */
  minScale: number
  /** Максимальный масштаб экземпляра */
  maxScale: number
  /** Макс. экземпляров для L0 (geometry) буфера */
  maxL0Instances: number
  /** Макс. экземпляров для L1 (billboard) буфера */
  maxL1Instances: number
  /** LOD-пороги в реальных км */
  lodThresholdsKm: {
    l0: number
    l1: number
  }
}

/**
 * Конфигурация по умолчанию (рассчитана на кольцо типа Сатурна).
 */
const DEFAULT_CONFIG: Partial<AsteroidRingConfig> = {
  thicknessKm: 400,
  cellSizeKm: 2000,
  densityPerUnit: 500,
  asteroidSizeKm: 10,
  minScale: 0.3,
  maxScale: 1.6,
  maxL0Instances: 50000,
  maxL1Instances: 100000,
  lodThresholdsKm: {
    l0: 3000,
    l1: 12000
  }
}

/**
 * AsteroidRingSystem — основной оркестратор системы визуализации астероидов в кольце.
 *
 * Заменяет DetailedRingV2. Добавляется как child к Ring mesh (тот же паттерн).
 *
 * Состоит из:
 * - SectorGrid: полярная сетка секторов
 * - SectorManager: lifecycle секторов, LOD-решения
 * - InstancePool: GPU-буферы (L0 geometry + L1 billboard)
 * - AsteroidGenerator: детерминированная процедурная генерация
 */
class AsteroidRingSystem extends Group {
  public model: Actor

  declare private sectorGrid: SectorGrid
  declare private generator: AsteroidGenerator
  declare private pool: InstancePool
  declare private manager: SectorManager

  private readonly config: AsteroidRingConfig

  // Reusable objects
  private readonly _localCamPos = new Vector3()
  private readonly _worldPos = new Vector3()
  private readonly _viewProjMatrix = new Matrix4()

  /** Флаг: система была деактивирована (parent invisible) */
  private wasDeactivated = false

  public constructor(model: Actor, configOverrides: Partial<AsteroidRingConfig> = {}) {
    super()
    this.model = model

    const renderData = model.renderingObject?.getAttribute('data')
    this.config = {
      ...DEFAULT_CONFIG,
      innerRadiusKm: renderData?.innerRadius ?? 70000,
      outerRadiusKm: renderData?.outerRadius ?? 140000,
      ringId: model.getAttribute('id') ?? 1,
      ...configOverrides
    } as AsteroidRingConfig

    this.__setup()
  }

  public __setup(): void {
    const cfg = this.config

    // --- Конвертация в Three.js units ---
    const innerRadius = toThreeJSUnits(cfg.innerRadiusKm)
    const outerRadius = toThreeJSUnits(cfg.outerRadiusKm)
    const thickness = toThreeJSUnits(cfg.thicknessKm)
    const cellSize = toThreeJSUnits(cfg.cellSizeKm)
    const asteroidSize = toThreeJSUnits(cfg.asteroidSizeKm)

    const l0MaxDist = toThreeJSUnits(cfg.lodThresholdsKm.l0)
    const l1MaxDist = toThreeJSUnits(cfg.lodThresholdsKm.l1)

    // --- SectorGrid ---
    const gridConfig: SectorGridConfig = {
      innerRadius,
      outerRadius,
      cellSize,
      ringId: cfg.ringId,
      densityPerUnit: cfg.densityPerUnit
    }
    this.sectorGrid = new SectorGrid(gridConfig)

    // --- AsteroidGenerator ---
    const genConfig: GeneratorConfig = {
      thickness,
      minScale: cfg.minScale,
      maxScale: cfg.maxScale
    }
    this.generator = new AsteroidGenerator(genConfig)

    // --- InstancePool ---
    const l0PoolConfig: PoolLayerConfig = { maxInstances: cfg.maxL0Instances }
    const l1PoolConfig: PoolLayerConfig = { maxInstances: cfg.maxL1Instances }
    this.pool = new InstancePool(l0PoolConfig, l1PoolConfig, asteroidSize)

    // Добавить рендер-объекты (L0 + L1)
    for (const obj of this.pool.getRenderObjects()) {
      this.add(obj)
    }

    // Установить maxDistance для billboard материала
    this.pool.billboardMaterial.uniforms.uMaxDistance.value = l1MaxDist

    // --- SectorManager ---
    const thresholds: LODThresholds = {
      l0MaxDistance: l0MaxDist,
      l1MaxDistance: l1MaxDist
    }
    this.manager = new SectorManager(this.sectorGrid, this.generator, this.pool, thresholds)

    // --- Поворот ---
    this.rotateX(degToRad(90))

    this.name = 'AsteroidRingSystem'
  }

  /**
   * Вызывается каждый кадр из render loop.
   */
  public updateObject(delta?: number): void {
    const dt = delta ?? 0.016

    // Проверить видимость parent'а
    if (!this.isEffectivelyVisible()) {
      if (!this.wasDeactivated) {
        this.manager.deactivateAll()
        this.pool.commitUpdates()
        this.wasDeactivated = true
      }
      return
    }

    if (this.wasDeactivated) {
      this.wasDeactivated = false
    }

    // Получить камеру
    const camera = threeJS.camera as PerspectiveCamera
    if (!camera) return

    // Позиция камеры в local space системы
    this._localCamPos.copy(camera.getWorldPosition(this._worldPos))
    this.worldToLocal(this._localCamPos)

    // Полярные координаты камеры в local space
    const cameraAngle = Math.atan2(this._localCamPos.z, this._localCamPos.x)
    const cameraRadius = Math.sqrt(
      this._localCamPos.x * this._localCamPos.x + this._localCamPos.z * this._localCamPos.z
    )

    // View-projection matrix для frustum culling
    this._viewProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

    // Local-to-world matrix системы
    this.updateWorldMatrix(true, false)
    const localToWorld = this.matrixWorld

    // Обновить менеджер секторов
    this.manager.update(cameraAngle, cameraRadius, this._viewProjMatrix, localToWorld, dt)

    // Коммит изменений в GPU
    this.pool.commitUpdates()
  }

  /**
   * Установить позицию источника света (звезды) в world space.
   * Влияет на освещение billboard-импосторов (L1).
   * По умолчанию [0, 0, 0] — центр системы.
   */
  public setLightPosition(x: number, y: number, z: number): void {
    this.pool.billboardMaterial.uniforms.uLightPosition.value.set(x, y, z)
  }

  /**
   * Проверка, видна ли система (учитывает LOD-переключения родителя).
   */
  private isEffectivelyVisible(): boolean {
    let obj: any = this.parent
    while (obj) {
      if (obj.visible === false) return false
      obj = obj.parent
    }
    return true
  }

  /**
   * Диагностика для debug overlay.
   */
  public getDebugInfo(): {
    totalSectors: number
    activeSectors: number
    sectorsByLod: { l0: number; l1: number }
    instances: { l0: number; l1: number; total: number }
    pendingRemoval: number
  } {
    const managerInfo = this.manager.getDebugInfo()
    const poolInfo = this.pool.getActiveCount()

    return {
      totalSectors: this.sectorGrid.totalSectorCount,
      activeSectors: managerInfo.activeSectors,
      sectorsByLod: managerInfo.byLod,
      instances: poolInfo,
      pendingRemoval: managerInfo.pendingRemoval
    }
  }

  /**
   * Полный сброс (например, при изменении параметров кольца).
   */
  public reset(): void {
    this.manager.deactivateAll()
    this.pool.reset()
  }
}

export { AsteroidRingSystem }
export type { AsteroidRingConfig }
