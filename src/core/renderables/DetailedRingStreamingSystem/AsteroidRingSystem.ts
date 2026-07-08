import { Color, Group, Matrix4, Object3D, PerspectiveCamera, RepeatWrapping, Vector3, type Texture } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { threeJS } from '@/core/graphic/ThreeJS'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { readRingAlphaProfile, readRingAlphaBins } from './RingAlphaReadback'
import { createDustRadialTexture } from './dust/DustRadialProfile'
import { SectorGrid, SectorGridConfig } from './SectorGrid'
import { AsteroidGenerator, GeneratorConfig } from './AsteroidGenerator'
import { InstancePool, PoolLayerConfig } from './InstancePool'
import { SectorManager, LODThresholds } from './SectorManager'
import { RingDustVolume } from './dust/RingDustVolume'
import { installRingDustDebug, type RockDustUniforms } from './dust/RingDustDebug'
import { ASTEROID_PROFILES, type AsteroidProfileName } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { UpdateContext } from '@/core/UpdateContext'

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
  /** Макс. экземпляров для ближнего L0 (повышенный detail) буфера */
  maxL0NearInstances: number
  /** Макс. экземпляров для L1 (billboard) буфера */
  maxL1Instances: number
  /** LOD-пороги в реальных км */
  lodThresholdsKm: {
    /** Ближний тир L0 (повышенный detail) — для самых близких камней */
    l0Near: number
    l0: number
    l1: number
  }
  /** Включена ли пылевая дымка */
  dustEnabled: boolean
  /** Цвет дымки: число 0xRRGGBB или строка '#rrggbb' */
  dustColor: number | string
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
  /** Уровень сабдива ближнего тира L0 (обычно на 1 выше asteroidShapeDetail) */
  asteroidShapeNearDetail: number
  /** Мин. амплитуда деформации силуэта (доля радиуса; min=max=0 → форма выключена) */
  shapeAmpMin: number
  /** Макс. амплитуда деформации силуэта (доля радиуса). Каждый инстанс берёт
   *  своё значение из [min,max] по декоррелированному хешу позиции */
  shapeAmpMax: number
  /** Частота шума деформации силуэта */
  shapeFreq: number
  /** Профиль облика астероидов (см. AsteroidProfiles). Задаёт цвет/кратеры/блик/etc. */
  profile: AsteroidProfileName
  /** Дальность детализации: начало гашения детали (циклов зерна на пиксель) */
  detailAaStart: number
  /** Дальность детализации: полное гашение. Больше → деталь держится дальше */
  detailAaEnd: number
  /**
   * Распределение камней и пыли следует альфе текстуры 2D-кольца (радиальный
   * профиль плотности + профиль пыли). Тот же радиальный маппинг, что у
   * RingShader → щели/субкольца 3D совпадают с 2D. false → равномерно.
   */
  ringGapsFromTexture: boolean
  /**
   * Мягкость кромок субколец: сигма размытия радиального профиля плотности в км.
   * Камни немного выходят за текстурное субкольцо (~2σ), кромка — градиент, а не
   * «астероидный забор». 0 — резкие кромки, как в текстуре.
   */
  ringGapBleedKm: number
  /**
   * Мягкость согласования ПЫЛИ с текстурой кольца: сигма размытия радиального
   * профиля пыли в км. Пыль диффузнее камней → дефолт шире, чем ringGapBleedKm.
   * Порог alphaTest к пыли не применяется: тусклые полосы текстуры — это и есть
   * пыль, они получают пропорционально тусклую дымку.
   */
  dustBleedKm: number
  /** Повторов текстуры на радиус камня (в Three.js units) — тексель-плотность PBR-микрослоя */
  detailRepeats: number
  /** Доля цвета текстуры против грейда процедурного профиля (0 — только профиль, 1 — только текстура) */
  detailSaturation: number
  /** Компенсация средней яркости диффуза (фотограмметрия темнее процедурного альбедо) */
  detailBrightness: number
  /** Сила нормал-карты микрослоя */
  detailNormalScale: number
  /** Влияние AO-канала из ARM-текстуры */
  detailAoInfluence: number
  /** Влияние rough-канала из ARM-текстуры */
  detailRoughInfluence: number
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
  maxL0NearInstances: 20000,
  maxL1Instances: 100000,
  lodThresholdsKm: {
    l0Near: 1000,
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
  asteroidShapeNearDetail: 3,
  shapeAmpMin: 0.08,
  shapeAmpMax: 0.22,
  shapeFreq: 1.4,
  profile: 'stony',
  detailAaStart: 1.2,
  detailAaEnd: 3.0,
  ringGapsFromTexture: true,
  ringGapBleedKm: 300,
  dustBleedKm: 600,
  detailRepeats: 2.0,
  detailSaturation: 0.35,
  detailBrightness: 1.6,
  detailNormalScale: 1.0,
  detailAoInfluence: 0.8,
  detailRoughInfluence: 0.7
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

  // Троттлинг dev-предупреждения об исчерпании пула инстансов
  private lastPoolWarnAt = 0
  private lastPoolFailures = 0

  // A-lite: радиальный профиль плотности из текстуры кольца строится один раз,
  // когда текстура догрузилась (async). До этого — равномерная плотность + B-гейт.
  private densityProfileReady = false
  private ringInnerTU = 0
  private ringOuterTU = 0

  public constructor(model: Actor, configOverrides: Partial<AsteroidRingConfig> = {}) {
    super()
    this.model = model

    const renderData = model.renderingObject?.getAttribute('data')
    this.config = {
      ...DEFAULT_CONFIG,
      innerRadiusKm: renderData?.innerRadius ?? 70000,
      outerRadiusKm: renderData?.outerRadius ?? 140000,
      ringId: model.getAttribute('id') ?? 1,
      // Пер-кольцевая плотность: базовая × множитель из модели (1 при отсутствии).
      // Явный override в configOverrides имеет приоритет (спред ниже).
      densityPerUnit: (DEFAULT_CONFIG.densityPerUnit ?? 500) * (renderData?.asteroidDensityScale ?? 1),
      ...AsteroidRingSystem.__modelVisualOverrides(renderData),
      ...configOverrides
    } as AsteroidRingConfig

    this.__setup()
  }

  /**
   * Визуальные ручки из модельного слоя (IRingRenderingObject.data) — только
   * ЗАДАННЫЕ поля, отсутствующие не затирают дефолты. Приоритет:
   * DEFAULT_CONFIG < данные модели < configOverrides (код). Машинерия
   * (LOD/пулы/сетка) через модель не настраивается — тюнится в коде.
   */
  private static __modelVisualOverrides(data: Partial<IRingRenderingObject> | undefined): Partial<AsteroidRingConfig> {
    if (!data) return {}

    const overrides: Partial<AsteroidRingConfig> = {}
    if (data.thicknessKm !== undefined) overrides.thicknessKm = data.thicknessKm
    if (data.asteroidSizeKm !== undefined) overrides.asteroidSizeKm = data.asteroidSizeKm
    if (data.ringGapBleedKm !== undefined) overrides.ringGapBleedKm = data.ringGapBleedKm
    if (data.dustBleedKm !== undefined) overrides.dustBleedKm = data.dustBleedKm
    if (data.dustEnabled !== undefined) overrides.dustEnabled = data.dustEnabled
    if (data.dustColor !== undefined) overrides.dustColor = data.dustColor
    if (data.dustTauGrazing !== undefined) overrides.dustTauGrazing = data.dustTauGrazing
    if (data.dustScaleHeightKm !== undefined) overrides.dustScaleHeightKm = data.dustScaleHeightKm
    // Имя профиля приходит строкой из JSON — неизвестное тихо игнорируем
    // (останется дефолт), чтобы опечатка в редакторе данных не роняла рендер
    if (data.profile !== undefined && data.profile in ASTEROID_PROFILES) {
      overrides.profile = data.profile as AsteroidProfileName
    }

    return overrides
  }

  public __setup(): void {
    const cfg = this.config

    // --- Конвертация в Three.js units ---
    const innerRadius = toThreeJSUnits(cfg.innerRadiusKm)
    const outerRadius = toThreeJSUnits(cfg.outerRadiusKm)
    const thickness = toThreeJSUnits(cfg.thicknessKm)
    const cellSize = toThreeJSUnits(cfg.cellSizeKm)
    const asteroidSize = toThreeJSUnits(cfg.asteroidSizeKm)

    const l0NearMaxDist = toThreeJSUnits(cfg.lodThresholdsKm.l0Near)
    const l0MaxDist = toThreeJSUnits(cfg.lodThresholdsKm.l0)
    const l1MaxDist = toThreeJSUnits(cfg.lodThresholdsKm.l1)

    // Радиусы кольца в three-units — для A-lite readback профиля (см. updateObject)
    this.ringInnerTU = innerRadius
    this.ringOuterTU = outerRadius

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
    const l0NearPoolConfig: PoolLayerConfig = { maxInstances: cfg.maxL0NearInstances }
    this.pool = new InstancePool(
      l0PoolConfig,
      l1PoolConfig,
      asteroidSize,
      cfg.asteroidShapeDetail,
      l0NearPoolConfig,
      cfg.asteroidShapeNearDetail
    )

    // Добавить рендер-объекты (L0 + L1)
    for (const obj of this.pool.getRenderObjects()) {
      this.add(obj)
    }

    // Деформация силуэта — только L0 (у billboard-материала этих юниформ нет)
    const l0ShapeMaterial = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    l0ShapeMaterial.uniforms.uShapeAmpMin.value = cfg.shapeAmpMin
    l0ShapeMaterial.uniforms.uShapeAmpMax.value = cfg.shapeAmpMax
    l0ShapeMaterial.uniforms.uShapeFreq.value = cfg.shapeFreq

    // Процедурный облик — профиль, тоже только L0
    const profile = ASTEROID_PROFILES[cfg.profile]
    l0ShapeMaterial.uniforms.uRockColor.value.set(profile.baseColor)
    l0ShapeMaterial.uniforms.uColorJitter.value = profile.colorJitter
    l0ShapeMaterial.uniforms.uTintStrength.value = profile.tintStrength
    l0ShapeMaterial.uniforms.uMariaStrength.value = profile.mariaStrength
    l0ShapeMaterial.uniforms.uCraterFreq.value = profile.craterFreq
    l0ShapeMaterial.uniforms.uCraterDensity.value = profile.craterDensity
    l0ShapeMaterial.uniforms.uCraterRadius.value = profile.craterRadius
    l0ShapeMaterial.uniforms.uCraterDepth.value = profile.craterDepth
    l0ShapeMaterial.uniforms.uCraterOctaves.value = profile.craterOctaves
    l0ShapeMaterial.uniforms.uAoStrength.value = profile.aoStrength
    l0ShapeMaterial.uniforms.uCraterNormalScale.value = profile.craterNormalScale
    l0ShapeMaterial.uniforms.uSurfaceAmbient.value = profile.surfaceAmbient
    l0ShapeMaterial.uniforms.uSpecularStrength.value = profile.specularStrength
    l0ShapeMaterial.uniforms.uSpecularPower.value = profile.specularPower
    l0ShapeMaterial.uniforms.uSpecularTint.value = profile.specularTint
    // Дальность детализации (fwidth-AA) — общая, не per-profile (про экран/LOD)
    l0ShapeMaterial.uniforms.uAaStart.value = cfg.detailAaStart
    l0ShapeMaterial.uniforms.uAaEnd.value = cfg.detailAaEnd

    // PBR-микрослой (фотограмметрические текстуры) — поверх процедурного профиля
    this.__applyDetailMaps(asteroidSize)

    // Установить maxDistance для billboard материала
    this.pool.billboardMaterial.uniforms.uMaxDistance.value = l1MaxDist

    // --- SectorManager ---
    const thresholds: LODThresholds = {
      l0NearMaxDistance: l0NearMaxDist,
      l0MaxDistance: l0MaxDist,
      l1MaxDistance: l1MaxDist
    }
    this.manager = new SectorManager(this.sectorGrid, this.generator, this.pool, thresholds)

    // --- Тень планеты (умбра) — общая для камней/пыли/2D-кольца ---
    // Радиус планеты в ring-local (начало ring-local = центр планеты, тот же
    // источник, что у RingShader). Прокидываем в материалы камней НЕЗАВИСИМО от
    // пыли: тень камней (ringDustPlanetShadow) не должна отключаться вместе с
    // дымкой. 0 при отсутствии планеты → тень выключена.
    const planetRadiusKm = this.model.parent?.physicalObject?.getAttribute('radius', 0) ?? 0
    const planetRadius = toThreeJSUnits(planetRadiusKm)
    const l0Mat = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    for (const uniforms of [l0Mat.uniforms, this.pool.billboardMaterial.uniforms]) {
      uniforms.uDustPlanetRadius.value = planetRadius
    }

    // --- RingDustVolume (пылевая дымка) ---
    if (cfg.dustEnabled) {
      const dustScaleHeight = toThreeJSUnits(cfg.dustScaleHeightKm)
      // Калибровка спеки: tau грейзинг-луча через всё кольцо в средней плоскости = dustTauGrazing
      const dustDensity = cfg.dustTauGrazing / (outerRadius - innerRadius)
      const dustNearFade = toThreeJSUnits(cfg.dustNearFadeKm)
      const dustPlanetRadius = planetRadius

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
   * Привязать PBR-микрослой (см. чанк TriplanarDetail). Текстуры — required-
   * ресурсы (загружены до engine.start); нет любой из трёх → слой тихо
   * выключен (uDetailMapsEnabled 0), камни рендерятся прежним процедурным путём.
   */
  private __applyDetailMaps(asteroidSize: number): void {
    const diff = resourceStorage.getTexture('asteroids/rock_boulder_dry_diff_2k.jpg')
    const nor = resourceStorage.getTexture('asteroids/rock_boulder_dry_nor_gl_2k.jpg')
    const arm = resourceStorage.getTexture('asteroids/rock_boulder_dry_arm_2k.jpg')
    if (!diff || !nor || !arm) return

    for (const map of [diff, nor, arm]) map.wrapS = map.wrapT = RepeatWrapping

    const cfg = this.config
    const l0Material = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    const u = l0Material.uniforms
    u.uRockDiffMap.value = diff
    u.uRockNorMap.value = nor
    u.uRockArmMap.value = arm
    u.uDetailMapsEnabled.value = 1
    // Тексель-плотность: cfg.detailRepeats повторов тайла на радиус камня
    u.uDetailScale.value = cfg.detailRepeats / asteroidSize
    u.uDetailSaturation.value = cfg.detailSaturation
    u.uDetailBrightness.value = cfg.detailBrightness
    u.uDetailNormalScale.value = cfg.detailNormalScale
    u.uDetailAoInfluence.value = cfg.detailAoInfluence
    u.uDetailRoughInfluence.value = cfg.detailRoughInfluence
  }

  /**
   * Вызывается каждый кадр из render loop.
   */
  public updateObject(ctx: UpdateContext): void {
    const dt = ctx.delta

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

    // A-lite: попытаться построить радиальный профиль плотности (когда текстура
    // кольца догрузилась). Дешёвая проверка флага, пока не построен.
    this.__tryBuildDensityProfile()

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

    // Направление на звезду в ring-local — нужно для тени планеты на камни
    // (ringDustPlanetShadow), поэтому считаем и прокидываем НЕЗАВИСИМО от пыли.
    this._localLightDir.copy(this._lightWorldPos)
    this.worldToLocal(this._localLightDir)
    this._localLightDir.normalize()

    const l0Material = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    l0Material.uniforms.uDustLightDirRing.value.copy(this._localLightDir)
    this.pool.billboardMaterial.uniforms.uDustLightDirRing.value.copy(this._localLightDir)

    // Пер-кадровые юниформы дымки: позиция камеры в ring-local (для аэроперспективы)
    if (this.dustVolume) {
      this.dustVolume.updatePerFrame(this._localCamPos, this._localLightDir)
      l0Material.uniforms.uDustCamRingPos.value.copy(this._localCamPos)
      this.pool.billboardMaterial.uniforms.uDustCamRingPos.value.copy(this._localCamPos)
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

    // Диагностика: молчаливые отказы аллокации = сектора пропадают из рендера
    // (дырки в L0 при заполненном пуле). Подсвечиваем в dev, не чаще раза в 5с.
    if (import.meta.env.DEV) this.__warnOnPoolExhaustion()
  }

  private __warnOnPoolExhaustion(): void {
    const pressure = this.pool.getPressureInfo()
    if (pressure.totalFailures <= this.lastPoolFailures) return

    const now = performance.now()
    if (now - this.lastPoolWarnAt >= 5000) {
      this.lastPoolWarnAt = now
      console.warn(
        `[AsteroidRingSystem ${this.config.ringId}] Пул инстансов исчерпан — сектора молча пропадают из рендера. ` +
          `Отказов аллокации: ${pressure.totalFailures}. ` +
          `Занятость: L0Near ${pressure.l0Near.used}/${pressure.l0Near.capacity}, ` +
          `L0 ${pressure.l0.used}/${pressure.l0.capacity}, L1 ${pressure.l1.used}/${pressure.l1.capacity}. ` +
          'Лечится ростом maxL*Instances или снижением asteroidDensityScale.'
      )
    }
    this.lastPoolFailures = pressure.totalFailures
  }

  /**
   * Один раз построить радиальный профиль плотности из альфы текстуры кольца
   * и отдать его в SectorGrid/генератор (+ профиль пыли в материалы). Пустотные
   * полосы не генерируются вовсе (нет waste на пустотах разреженных колец).
   * До готовности текстуры — равномерная плотность (краткое окно первых кадров).
   * Профиль вбирает семантику alphaTest 2D-кольца (отсечка) и даёт мягкие
   * кромки субколец (ringGapBleedKm). Нечитаемая текстура → кольцо без щелей,
   * но без краша.
   */
  private __tryBuildDensityProfile(): void {
    if (this.densityProfileReady || !this.config.ringGapsFromTexture) return

    const path = this.model.resources?.first()?.getAttribute('path')
    if (!path) {
      this.densityProfileReady = true // нет ресурса → профиля не будет, не ретраим
      return
    }

    // Реальная текстура (не fallback): getTexture вернёт её только после загрузки.
    const texture = resourceStorage.getTexture(path)
    if (!texture) return // ещё грузится (напр. s3) → повторим в следующем кадре

    const ringData = this.model.renderingObject?.getAttribute('data')
    const profile = readRingAlphaProfile(texture, this.ringInnerTU, this.ringOuterTU, {
      alphaTest: ringData?.alphaTest ?? 0,
      blurRadius: toThreeJSUnits(this.config.ringGapBleedKm)
    })
    if (profile) {
      // SectorGrid — верное КОЛИЧЕСТВО (вес по средней альфе), генератор —
      // КОНЦЕНТРАЦИЯ (радиус ∝ альфе). Вместе → плотность колечка = base.
      this.sectorGrid.setDensityProfile(profile)
      this.generator.setDensityProfile(profile)
    }

    this.__applyDustRadialProfile(texture)
    this.densityProfileReady = true // строим один раз (успех или нечитаемо)
  }

  /**
   * Согласовать пыль с текстурой кольца: радиальный профиль альфы (свой,
   * более широкий blur и БЕЗ порога — тусклые полосы дают тусклую дымку)
   * уходит 1D-текстурой во все три материала модели RingDust. Модуляция
   * нормирована на среднее 1 → калибровка dustTauGrazing сохраняется,
   * пыль лишь перераспределяется в субкольца. Нечитаемо → равномерная пыль.
   */
  private __applyDustRadialProfile(texture: Texture): void {
    const bins = readRingAlphaBins(texture, this.ringInnerTU, this.ringOuterTU, {
      blurRadius: toThreeJSUnits(this.config.dustBleedKm)
    })
    if (!bins) return

    const radial = createDustRadialTexture(bins)
    if (!radial) return

    const l0Material = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    const uniformSets = [l0Material.uniforms, this.pool.billboardMaterial.uniforms]
    if (this.dustVolume) uniformSets.push(this.dustVolume.dustMaterial.uniforms)
    for (const uniforms of uniformSets) {
      uniforms.uDustRadialMap.value = radial.texture
      uniforms.uDustRadialMapScale.value = radial.scale
    }
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
    let obj: Object3D | null = this.parent
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
    poolPressure: ReturnType<InstancePool['getPressureInfo']>
  } {
    const managerInfo = this.manager.getDebugInfo()
    const poolInfo = this.pool.getActiveCount()

    return {
      totalSectors: this.sectorGrid.totalSectorCount,
      activeSectors: managerInfo.activeSectors,
      sectorsByLod: managerInfo.byLod,
      instances: poolInfo,
      pendingRemoval: managerInfo.pendingRemoval,
      poolPressure: this.pool.getPressureInfo()
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
