import { Frustum, Matrix4, Sphere, Vector3 } from 'three'
import { SectorGrid, SectorInfo } from './SectorGrid'
import { AsteroidGenerator } from './AsteroidGenerator'
import { InstancePool, LODLevel, Allocation } from './InstancePool'

/**
 * Конфигурация LOD-порогов
 */
interface LODThresholds {
  /** Максимальное расстояние для ближнего тира L0 (повышенный detail) */
  l0NearMaxDistance: number
  /** Максимальное расстояние для L0 (реальная геометрия, обычный detail) */
  l0MaxDistance: number
  /** Максимальное расстояние для L1 (billboards) — дальше ничего не грузим */
  l1MaxDistance: number
}

/**
 * Состояние активного сектора
 */
interface SectorState {
  key: string
  info: SectorInfo
  lodLevel: LODLevel
  allocation: Allocation
  /** Текущее значение fade (0 = невидим, 1 = полностью виден) */
  fade: number
  /** Целевое значение fade */
  fadeTarget: number
  /** Помечен для удаления после завершения fade-out */
  pendingRemoval: boolean
}

/**
 * SectorManager — управляет жизненным циклом активных секторов.
 *
 * Каждый кадр:
 * 1. Определяет какие секторы должны быть видны (на основе позиции камеры + frustum)
 * 2. Рассчитывает LOD-уровень для каждого (L0 Geometry / L1 Billboard)
 * 3. Активирует новые секторы (с бюджетом — не более N за кадр)
 * 4. Деактивирует ушедшие за пределы видимости
 * 5. Обрабатывает fade-переходы
 * 6. При смене LOD — переключает сектор между буферами
 */
class SectorManager {
  private grid: SectorGrid
  private generator: AsteroidGenerator
  private pool: InstancePool
  private thresholds: LODThresholds

  /** Активные секторы: key → state */
  private activeSectors: Map<string, SectorState> = new Map()

  /** Максимальное количество секторов, активируемых за один кадр */
  private readonly activationBudget: number = 4

  /** Скорость fade (доля за секунду, 1.0 = полный fade за 1 секунду) */
  private readonly fadeSpeed: number = 4.0

  /** Множитель плотности instances per sector для каждого LOD */
  private readonly lodDensityMultiplier = {
    [LODLevel.GeometryNear]: 1.0,
    [LODLevel.Geometry]: 1.0,
    [LODLevel.Billboard]: 1.5
  }

  // Reusable objects
  private readonly _frustum = new Frustum()
  private readonly _sphere = new Sphere()
  private readonly _worldCenter = new Vector3()

  public constructor(grid: SectorGrid, generator: AsteroidGenerator, pool: InstancePool, thresholds: LODThresholds) {
    this.grid = grid
    this.generator = generator
    this.pool = pool
    this.thresholds = thresholds
  }

  /**
   * Основной метод обновления. Вызывается каждый кадр.
   *
   * @param cameraAngle — угол камеры в полярных координатах (radians) в local space кольца
   * @param cameraRadius — расстояние камеры от центра кольца в local space
   * @param viewProjectionMatrix — camera.projectionMatrix * camera.matrixWorldInverse
   * @param localToWorldMatrix — матрица трансформации системы (local → world)
   * @param delta — время с прошлого кадра (секунды)
   */
  public update(
    cameraAngle: number,
    cameraRadius: number,
    viewProjectionMatrix: Matrix4,
    localToWorldMatrix: Matrix4,
    delta: number
  ): void {
    // 1. Подготовить frustum
    this._frustum.setFromProjectionMatrix(viewProjectionMatrix)

    // 2. Получить кандидатов из сетки
    const maxRange = this.thresholds.l1MaxDistance
    const candidates = this.grid.getSectorsInRange(cameraAngle, cameraRadius, maxRange)

    // 3. Определить LOD и отфильтровать по frustum
    const desiredSectors = new Map<string, { info: SectorInfo; lod: LODLevel }>()

    const camX = Math.cos(cameraAngle) * cameraRadius
    const camZ = Math.sin(cameraAngle) * cameraRadius

    for (const info of candidates) {
      const dx = info.centerX - camX
      const dz = info.centerZ - camZ
      const dist = Math.sqrt(dx * dx + dz * dz)

      // Определить LOD (по возрастанию расстояния: ближний detail → L0 → billboard)
      let lod: LODLevel
      if (dist <= this.thresholds.l0NearMaxDistance) {
        lod = LODLevel.GeometryNear
      } else if (dist <= this.thresholds.l0MaxDistance) {
        lod = LODLevel.Geometry
      } else if (dist <= this.thresholds.l1MaxDistance) {
        lod = LODLevel.Billboard
      } else {
        continue
      }

      // Frustum culling
      this._worldCenter.set(info.centerX, 0, info.centerZ)
      this._worldCenter.applyMatrix4(localToWorldMatrix)
      this._sphere.set(this._worldCenter, info.boundingRadius)

      if (!this._frustum.intersectsSphere(this._sphere)) {
        continue
      }

      desiredSectors.set(info.key, { info, lod })
    }

    // 4. Diff: определить что активировать/деактивировать/переключить LOD
    const toActivate: { info: SectorInfo; lod: LODLevel }[] = []
    const toChangeLOD: { state: SectorState; newLOD: LODLevel; info: SectorInfo }[] = []

    for (const [key, desired] of desiredSectors) {
      const existing = this.activeSectors.get(key)
      if (!existing) {
        toActivate.push(desired)
      } else if (existing.lodLevel !== desired.lod && !existing.pendingRemoval) {
        toChangeLOD.push({ state: existing, newLOD: desired.lod, info: desired.info })
      } else if (existing.pendingRemoval) {
        existing.pendingRemoval = false
        existing.fadeTarget = 1.0
      }
    }

    // Секторы, которые больше не нужны → пометить для fade-out
    for (const [key, state] of this.activeSectors) {
      if (!desiredSectors.has(key) && !state.pendingRemoval) {
        state.pendingRemoval = true
        state.fadeTarget = 0.0
      }
    }

    // 5. Активация новых секторов (с бюджетом)
    toActivate.sort((a, b) => {
      const distA = (a.info.centerX - camX) ** 2 + (a.info.centerZ - camZ) ** 2
      const distB = (b.info.centerX - camX) ** 2 + (b.info.centerZ - camZ) ** 2
      return distA - distB
    })

    let activated = 0
    for (const { info, lod } of toActivate) {
      if (activated >= this.activationBudget) break
      if (this.activateSector(info, lod)) {
        activated++
      }
    }

    // 6. Смена LOD для существующих секторов
    for (const { state, newLOD, info } of toChangeLOD) {
      this.changeSectorLOD(state, newLOD, info)
    }

    // 7. Обновить fade и удалить завершённые fade-out
    this.updateFades(delta)
  }

  /**
   * Активировать новый сектор.
   */
  private activateSector(info: SectorInfo, lodLevel: LODLevel): boolean {
    const instanceCount = Math.max(1, Math.round(info.instanceCount * this.lodDensityMultiplier[lodLevel]))

    const allocation = this.pool.allocate(lodLevel, instanceCount)
    if (!allocation) {
      return false
    }

    const data = this.generator.generateMatrices(info.seed, instanceCount, info.bounds)
    this.pool.writeMatrices(lodLevel, allocation.offset, data)
    // Стартуем невидимым — updateFades плавно поднимет fade к 1.
    this.pool.writeFade(lodLevel, allocation.offset, allocation.count, 0.0)

    const state: SectorState = {
      key: info.key,
      info,
      lodLevel,
      allocation,
      fade: 0.0,
      fadeTarget: 1.0,
      pendingRemoval: false
    }

    this.activeSectors.set(info.key, state)
    return true
  }

  /**
   * Переключить сектор на другой LOD-уровень.
   */
  private changeSectorLOD(state: SectorState, newLOD: LODLevel, info: SectorInfo): void {
    this.pool.release(state.allocation)

    const instanceCount = Math.max(1, Math.round(info.instanceCount * this.lodDensityMultiplier[newLOD]))
    const allocation = this.pool.allocate(newLOD, instanceCount)

    if (!allocation) {
      this.activeSectors.delete(state.key)
      return
    }

    const data = this.generator.generateMatrices(info.seed, instanceCount, info.bounds)
    this.pool.writeMatrices(newLOD, allocation.offset, data)

    state.lodLevel = newLOD
    state.allocation = allocation
    // Новый LOD проявляется с 0.3 (не с нуля — переход между уровнями резче, чем
    // появление сектора «из пустоты»), дальше updateFades доводит до 1.
    state.fade = 0.3
    state.fadeTarget = 1.0
    this.pool.writeFade(newLOD, allocation.offset, allocation.count, state.fade)
  }

  /**
   * Обновить fade-анимации и удалить полностью погасшие секторы.
   */
  private updateFades(delta: number): void {
    const step = this.fadeSpeed * delta
    const toRemove: string[] = []

    for (const [key, state] of this.activeSectors) {
      if (state.fade !== state.fadeTarget) {
        if (state.fade < state.fadeTarget) {
          state.fade = Math.min(state.fade + step, state.fadeTarget)
        } else {
          state.fade = Math.max(state.fade - step, state.fadeTarget)
        }
        // fade изменился — залить новое значение в per-instance атрибут сектора.
        // Осевшие секторы (fade == fadeTarget) не трогаем → нет покадровых записей.
        this.pool.writeFade(state.lodLevel, state.allocation.offset, state.allocation.count, state.fade)
      }

      if (state.pendingRemoval && state.fade <= 0.001) {
        this.pool.release(state.allocation)
        toRemove.push(key)
      }
    }

    for (const key of toRemove) {
      this.activeSectors.delete(key)
    }
  }

  /**
   * Принудительно деактивировать все секторы.
   */
  public deactivateAll(): void {
    for (const [, state] of this.activeSectors) {
      this.pool.release(state.allocation)
    }
    this.activeSectors.clear()
  }

  /**
   * Количество активных секторов.
   */
  public get activeCount(): number {
    return this.activeSectors.size
  }

  /**
   * Диагностическая информация.
   */
  public getDebugInfo(): {
    activeSectors: number
    byLod: { l0: number; l1: number }
    pendingRemoval: number
  } {
    let l0 = 0,
      l1 = 0,
      pending = 0
    for (const [, state] of this.activeSectors) {
      switch (state.lodLevel) {
        case LODLevel.GeometryNear:
        case LODLevel.Geometry:
          l0++
          break
        case LODLevel.Billboard:
          l1++
          break
      }
      if (state.pendingRemoval) pending++
    }
    return { activeSectors: this.activeSectors.size, byLod: { l0, l1 }, pendingRemoval: pending }
  }
}

export { SectorManager }
export type { LODThresholds, SectorState }
