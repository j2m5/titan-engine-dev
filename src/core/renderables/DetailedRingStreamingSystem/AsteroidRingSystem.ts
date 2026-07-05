import { Color, Group, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { threeJS } from '@/core/graphic/ThreeJS'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { SectorGrid, SectorGridConfig } from './SectorGrid'
import { AsteroidGenerator, GeneratorConfig } from './AsteroidGenerator'
import { InstancePool, PoolLayerConfig } from './InstancePool'
import { SectorManager, LODThresholds } from './SectorManager'
import { RingDustVolume } from './dust/RingDustVolume'
import { installRingDustDebug, type RockDustUniforms } from './dust/RingDustDebug'

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
  /** Включена ли пылевая дымка */
  dustEnabled: boolean
  /** Цвет дымки (hex) */
  dustColor: number
  /** Масштабная полутолщина пылевого слоя H в км */
  dustScaleHeightKm: number
  /**
   * Целевая оптическая толща грейзинг-луча через всё кольцо в средней плоскости.
   * С аддитивным гало (см. RingDustRaymarchMaterial) задаёт пиковую интенсивность
   * дымки; калибруется на ширину кольца → плотность масштабно-инвариантна.
   */
  dustTauGrazing: number
  /** Дистанция полного проявления пыли в км (рамп ближней зоны) */
  dustNearFadeKm: number
  /** Крутизна гейта по углу обзора */
  dustAnglePower: number
  /** Бюджет шагов марша объёма */
  dustMaxSteps: number
  /** Уровень сабдива геометрии L0 (1/2/3) — ручка отката FPS для формы */
  asteroidShapeDetail: number
  /** Мин. амплитуда деформации силуэта (доля радиуса; min=max=0 → форма выключена) */
  shapeAmpMin: number
  /** Макс. амплитуда деформации силуэта (доля радиуса). Каждый инстанс берёт
   *  своё значение из [min,max] по декоррелированному хешу позиции */
  shapeAmpMax: number
  /** Частота шума деформации силуэта */
  shapeFreq: number
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
  },
  dustEnabled: true,
  dustColor: 0x9b968c,
  dustScaleHeightKm: 200,
  dustTauGrazing: 0.52,
  dustNearFadeKm: 3000,
  dustAnglePower: 2,
  dustMaxSteps: 16,
  asteroidShapeDetail: 2,
  shapeAmpMin: 0.3,
  shapeAmpMax: 0.8,
  shapeFreq: 1.4
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

  private dustVolume: RingDustVolume | null = null

  // Reusable objects
  private readonly _localCamPos = new Vector3()
  private readonly _worldPos = new Vector3()
  private readonly _viewProjMatrix = new Matrix4()
  private readonly _lightWorldPos = new Vector3()
  private readonly _localLightDir = new Vector3()

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
    this.pool = new InstancePool(l0PoolConfig, l1PoolConfig, asteroidSize, cfg.asteroidShapeDetail)

    // Добавить рендер-объекты (L0 + L1)
    for (const obj of this.pool.getRenderObjects()) {
      this.add(obj)
    }

    // Деформация силуэта — только L0 (у billboard-материала этих юниформ нет)
    const l0ShapeMaterial = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    l0ShapeMaterial.uniforms.uShapeAmpMin.value = cfg.shapeAmpMin
    l0ShapeMaterial.uniforms.uShapeAmpMax.value = cfg.shapeAmpMax
    l0ShapeMaterial.uniforms.uShapeFreq.value = cfg.shapeFreq

    // Установить maxDistance для billboard материала
    this.pool.billboardMaterial.uniforms.uMaxDistance.value = l1MaxDist

    // --- SectorManager ---
    const thresholds: LODThresholds = {
      l0MaxDistance: l0MaxDist,
      l1MaxDistance: l1MaxDist
    }
    this.manager = new SectorManager(this.sectorGrid, this.generator, this.pool, thresholds)

    // --- RingDustVolume (пылевая дымка) ---
    if (cfg.dustEnabled) {
      const dustScaleHeight = toThreeJSUnits(cfg.dustScaleHeightKm)
      // Калибровка спеки: tau грейзинг-луча через всё кольцо в средней плоскости = dustTauGrazing
      const dustDensity = cfg.dustTauGrazing / (outerRadius - innerRadius)
      const dustNearFade = toThreeJSUnits(cfg.dustNearFadeKm)
      // Радиус планеты для тени: тот же источник, что у 2D-кольца (RingShader) —
      // начало ring-local = центр планеты. 0 при отсутствии → тень выключена
      const planetRadiusKm = this.model.parent?.physicalObject?.getAttribute('radius', 0) ?? 0
      const dustPlanetRadius = toThreeJSUnits(planetRadiusKm)

      this.dustVolume = new RingDustVolume({
        innerRadius,
        outerRadius,
        dustScaleHeight,
        dustDensity,
        dustColor: new Color(cfg.dustColor),
        anglePower: cfg.dustAnglePower,
        nearFade: dustNearFade,
        maxSteps: cfg.dustMaxSteps,
        planetRadius: dustPlanetRadius
      })
      this.add(this.dustVolume)

      this.__applyDustStaticUniforms(
        dustScaleHeight,
        dustDensity,
        dustNearFade,
        innerRadius,
        outerRadius,
        dustPlanetRadius
      )

      // Диагностический хендл (dev-only)
      if (import.meta.env.DEV) {
        const l0Material = this.pool.geometryMesh.material as InstancedAsteroidMaterial
        installRingDustDebug({
          volume: this.dustVolume,
          // uniforms материалов типизированы как обобщённый bag three.js (IUniform<any>);
          // структура полей гарантирована конструкторами материалов (см. __applyDustStaticUniforms)
          rockUniforms: [l0Material.uniforms, this.pool.billboardMaterial.uniforms] as unknown as RockDustUniforms[]
        })
      }
    }

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

    // Пер-кадровые юниформы пыли: камера и направление на звезду в ring-local space
    if (this.dustVolume) {
      this._localLightDir.copy(this._lightWorldPos)
      this.worldToLocal(this._localLightDir)
      this._localLightDir.normalize()

      this.dustVolume.updatePerFrame(this._localCamPos, this._localLightDir)

      const l0Material = this.pool.geometryMesh.material as InstancedAsteroidMaterial
      l0Material.uniforms.uDustCamRingPos.value.copy(this._localCamPos)
      l0Material.uniforms.uDustLightDirRing.value.copy(this._localLightDir)
      this.pool.billboardMaterial.uniforms.uDustCamRingPos.value.copy(this._localCamPos)
      this.pool.billboardMaterial.uniforms.uDustLightDirRing.value.copy(this._localLightDir)
    }

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
   * Записать статические юниформы пыли в материалы камней (L0 + L1).
   * Модель плотности едина для всех трёх материалов — см. GLSL-чанк RingDust.
   */
  private __applyDustStaticUniforms(
    scaleHeight: number,
    density: number,
    nearFade: number,
    inner: number,
    outer: number,
    planetRadius: number
  ): void {
    const l0Material = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    for (const uniforms of [l0Material.uniforms, this.pool.billboardMaterial.uniforms]) {
      uniforms.uDustColor.value.set(this.config.dustColor)
      uniforms.uDustDensity.value = density
      uniforms.uDustScaleHeight.value = scaleHeight
      uniforms.uDustRingInner.value = inner
      uniforms.uDustRingOuter.value = outer
      uniforms.uDustAnglePower.value = this.config.dustAnglePower
      uniforms.uDustNearFade.value = nearFade
      uniforms.uDustPlanetRadius.value = planetRadius
    }
  }

  /**
   * Установить позицию источника света (звезды) в world space.
   * Влияет на освещение billboard-импосторов (L1) и на подсветку пылевой дымки.
   * По умолчанию [0, 0, 0] — центр системы.
   */
  public setLightPosition(x: number, y: number, z: number): void {
    this._lightWorldPos.set(x, y, z)
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
