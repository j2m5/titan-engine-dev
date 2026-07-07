import { Color, Group, Matrix4, Object3D, PerspectiveCamera, Vector3, type Texture } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
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
   * Спайк B: гейтить рендер камней по альфе текстуры 2D-кольца (радиальные
   * щели/полосы). Та же текстура и радиальный маппинг, что у RingShader →
   * 3D-щели совпадают с 2D. По умолчанию выключено.
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
  dustBleedKm: 600
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
    l0ShapeMaterial.uniforms.uGrainStrength.value = profile.grainStrength
    l0ShapeMaterial.uniforms.uGrainFreq.value = profile.grainFreq
    l0ShapeMaterial.uniforms.uCraterFreq.value = profile.craterFreq
    l0ShapeMaterial.uniforms.uCraterDensity.value = profile.craterDensity
    l0ShapeMaterial.uniforms.uCraterRadius.value = profile.craterRadius
    l0ShapeMaterial.uniforms.uCraterDepth.value = profile.craterDepth
    l0ShapeMaterial.uniforms.uCraterOctaves.value = profile.craterOctaves
    l0ShapeMaterial.uniforms.uCrackWidth.value = profile.crackWidth
    l0ShapeMaterial.uniforms.uCrackIntensity.value = profile.crackIntensity
    l0ShapeMaterial.uniforms.uCrackPatchiness.value = profile.crackPatchiness
    l0ShapeMaterial.uniforms.uAoStrength.value = profile.aoStrength
    l0ShapeMaterial.uniforms.uCraterNormalScale.value = profile.craterNormalScale
    l0ShapeMaterial.uniforms.uSurfaceAmbient.value = profile.surfaceAmbient
    l0ShapeMaterial.uniforms.uSpecularStrength.value = profile.specularStrength
    l0ShapeMaterial.uniforms.uSpecularPower.value = profile.specularPower
    l0ShapeMaterial.uniforms.uSpecularTint.value = profile.specularTint
    // Дальность детализации (fwidth-AA) — общая, не per-profile (про экран/LOD)
    l0ShapeMaterial.uniforms.uAaStart.value = cfg.detailAaStart
    l0ShapeMaterial.uniforms.uAaEnd.value = cfg.detailAaEnd

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

    // --- Спайк B: радиальные щели из альфы текстуры кольца (за флагом) ---
    // Та же текстура/радиусы, что у RingShader → 3D-щели ложатся на 2D. Пока
    // текстура не пришла, getTextureOrMake отдаёт fallback (полная альфа) → щелей
    // нет, ровно как у 2D-кольца до загрузки. Гейт — страховка для равномерного
    // распределения; после построения радиального профиля плотности он
    // выключается (см. __tryBuildDensityProfile).
    if (cfg.ringGapsFromTexture) {
      const ringData = this.model.renderingObject?.getAttribute('data')
      const gapAlphaTest = ringData?.alphaTest ?? 0
      // Путь текстуры кольца — тот же ресурс, что у RingShader. Гейт включаем
      // только при наличии текстуры: нет ресурса → гейт тихо выключен (не краш).
      const gapPath = this.model.resources?.first()?.getAttribute('path')
      const gapTexture = gapPath ? resourceStorage.getTextureOrMake(gapPath) : null
      if (gapTexture) {
        for (const uniforms of [l0Mat.uniforms, this.pool.billboardMaterial.uniforms]) {
          uniforms.uRingGapEnabled.value = 1
          uniforms.uRingGapMap.value = gapTexture
          uniforms.uRingGapInner.value = innerRadius
          uniforms.uRingGapOuter.value = outerRadius
          uniforms.uRingGapAlphaTest.value = gapAlphaTest
        }
      }
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
  }

  /**
   * A-lite: один раз построить радиальный профиль плотности из альфы текстуры
   * кольца и отдать его в SectorGrid. Пустотные полосы перестанут генерироваться
   * (нет waste на пустотах разреженных колец). До готовности текстуры — равномерная
   * плотность + B-гейт (визуал корректен всегда), поэтому переход незаметен.
   *
   * Профиль вбирает семантику гейта (отсечка по alphaTest) и добавляет мягкие
   * кромки (ringGapBleedKm), поэтому при успехе B-гейт ВЫКЛЮЧАЕТСЯ: жёсткий
   * discard по сырой альфе срезал бы размытые хвосты обратно в «забор».
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
      // Размещение теперь само кодирует щели → гейт лишний и вредный (см. док выше).
      // Остаётся включённым только как фоллбэк при нечитаемом профиле.
      this.__setRingGapGateEnabled(false)
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

  /** Включить/выключить B-гейт (discard по альфе текстуры кольца) у обоих материалов камней */
  private __setRingGapGateEnabled(enabled: boolean): void {
    const l0Material = this.pool.geometryMesh.material as InstancedAsteroidMaterial
    for (const uniforms of [l0Material.uniforms, this.pool.billboardMaterial.uniforms]) {
      uniforms.uRingGapEnabled.value = enabled ? 1 : 0
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
