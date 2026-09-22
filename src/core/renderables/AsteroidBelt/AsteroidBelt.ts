import { Color, Group, Vector3 } from 'three'
import type { Actor } from '@/core/models/Actor'
import type { UpdateContext } from '@/core/UpdateContext'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { toThreeJSUnits, fromAstronomicalUnits } from '@/core/helpers/scaling'
import { asteroidBeltParameters, type AsteroidBeltParameters } from './AsteroidBeltParameters'
import { AsteroidRingSystem, type AsteroidRingConfig } from '@/core/renderables/DetailedRingStreamingSystem'
import { shapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import { deriveStreamerScale } from '@/core/renderables/DetailedRingStreamingSystem/streamerScale'
import { buildBeltDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'
import { distanceToTorus, nextState, BeltLodState } from '@/core/renderables/DetailedRingStreamingSystem/beltDistance'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { ringLightDirection } from '@/core/renderables/DetailedRingStreamingSystem/ringLightDirection'
import { BeltPointLayer } from '@/core/renderables/DetailedRingStreamingSystem/BeltPointLayer'
import {
  ASTEROID_PROFILES,
  asteroidProfileNameOf,
  type AsteroidProfileName
} from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { resolveLightTint } from '@/core/helpers/lightSource'

/** Средняя дистанция состояния Mid — до неё стример спит, а не создаётся заново (см. спеку §4) */
const MID_THRESHOLD_AU = 1

/**
 * Пояс астероидов масштаба системы (категория asteroidBelt, id 11).
 *
 * Три состояния по расстоянию камеры до ТОРА (см. distanceToTorus):
 *  - Near — стример (AsteroidRingSystem, три тира L0/Near/L1) создан и виден;
 *  - Mid  — стример спит (visible = false, сектора деактивирует его же
 *           updateObject по isEffectivelyVisible), не уничтожается;
 *  - Far  — стример ещё не создан (пул ~14 МБ не аллоцируется до первого
 *           приближения).
 *
 * Дальний слой — пылевая лента (RingDustVolume) и точечная россыпь
 * (BeltPointLayer), обе поверх всего тора, видны во всех трёх состояниях; при
 * наличии пыли стример получает dustEnabled: false, чтобы не считать пыль
 * дважды. Точки ВСЕГДА видимы — кроссфейд с L1-биллбордами стримера у порога
 * Near считается per-point прямо в шейдере точек (см. BeltPointsShaderTemplate),
 * не общим множителем на весь слой.
 */
class AsteroidBelt extends Group {
  // Не "model": three.js уже объявляет это имя публичным на Object3D (см.
  // TitanThree/three-types.d.ts) — приватное поле того же имени ломает наследование
  private readonly actor: Actor
  private readonly params: AsteroidBeltParameters
  /** Один профиль на камни стримера и на дальний слой пыли — щели и сгущения совпадают */
  private readonly densityProfile: Float32Array
  private readonly depthVolumeRegistry: DepthVolumeRegistry | null

  private readonly innerRadiusTu: number
  private readonly outerRadiusTu: number
  private readonly halfThicknessTu: number
  private readonly nearThresholdTu: number
  private readonly midThresholdTu: number = fromAstronomicalUnits(MID_THRESHOLD_AU)

  private lodState: BeltLodState = BeltLodState.Far
  private streamer: AsteroidRingSystem | null = null
  private readonly dustVolume: RingDustVolume | null
  /** Точечная россыпь дальнего слоя — создана и видима всегда (в отличие от стримера); кроссфейд с L1 — в её шейдере */
  private readonly pointLayer: BeltPointLayer

  private readonly _cameraLocal = new Vector3()
  private readonly _worldPos = new Vector3()
  private readonly _localLightDir = new Vector3()

  public constructor(model: Actor, depthVolumeRegistry: DepthVolumeRegistry | null = null) {
    super()
    this.actor = model
    this.depthVolumeRegistry = depthVolumeRegistry
    this.params = asteroidBeltParameters(model)
    this.densityProfile = buildBeltDensityProfile(this.params.structure)

    this.innerRadiusTu = toThreeJSUnits(this.params.innerRadiusKm)
    this.outerRadiusTu = toThreeJSUnits(this.params.outerRadiusKm)
    this.halfThicknessTu = toThreeJSUnits(this.params.thicknessKm) * 0.5

    // Порог Near — l1MaxDistance стримера: у порога до тора меньше него пояс
    // виден как отдельные камни, дальше — уже не имеет смысла держать пул
    this.nearThresholdTu = toThreeJSUnits(deriveStreamerScale(this.params.meanSpacingKm).lodThresholdsKm.l1)

    this.dustVolume = this.params.dustEnabled ? this.__createDustVolume() : null
    if (this.dustVolume) this.add(this.dustVolume)

    this.pointLayer = this.__createPointLayer()
    this.add(this.pointLayer)

    this.name = 'AsteroidBelt'
  }

  private __createDustVolume(): RingDustVolume {
    const p = this.params
    const dustScaleHeight = toThreeJSUnits(p.dustScaleHeightKm)
    // Та же калибровка, что у AsteroidRingSystem: tau грейзинг-луча через
    // весь тор в средней плоскости = dustTauGrazing
    const dustDensity = p.dustTauGrazing / (this.outerRadiusTu - this.innerRadiusTu)

    return new RingDustVolume({
      innerRadius: this.innerRadiusTu,
      outerRadius: this.outerRadiusTu,
      dustScaleHeight,
      dustDensity,
      dustColor: new Color(p.dustColor),
      anglePower: 2,
      // Ближнее гашение — доля толщины пояса, как у стримера (dustNearFadeFraction)
      nearFade: 0.25 * toThreeJSUnits(p.thicknessKm),
      maxSteps: 16,
      planetRadius: 0,
      model: this.actor,
      // Звезда в начале координат пояса: лепесток дымки — по точке марша
      lightAtOrigin: true,
      radialProfile: this.densityProfile,
      registry: this.depthVolumeRegistry ?? undefined
    })
  }

  private __createPointLayer(): BeltPointLayer {
    const p = this.params
    // Тот же выбор профиля породы, что у стримера (см. ASTEROID_PROFILES) — цвет точек совпадает с камнями
    const profileName: AsteroidProfileName = asteroidProfileNameOf(p.profile)

    return new BeltPointLayer({
      innerR: this.innerRadiusTu,
      outerR: this.outerRadiusTu,
      halfThickness: this.halfThicknessTu,
      count: p.pointCount,
      seed: p.seed,
      profile: this.densityProfile,
      color: new Color(ASTEROID_PROFILES[profileName].baseColor),
      lightTint: resolveLightTint(this.actor),
      pointScale: p.pointScale,
      // Тот же порог, что уходит билборду L1 как uMaxDistance — см. BeltPointsShaderTemplate
      maxDistance: this.nearThresholdTu
    })
  }

  private __createStreamer(): AsteroidRingSystem {
    const p = this.params
    const scale = deriveStreamerScale(p.meanSpacingKm)

    const overrides: Partial<AsteroidRingConfig> = {
      innerRadiusKm: p.innerRadiusKm,
      outerRadiusKm: p.outerRadiusKm,
      thicknessKm: p.thicknessKm,
      planetRadiusKm: 0,
      frame: 'system',
      relativeOrigin: true,
      densityProfileSource: this.densityProfile,
      densityPerUnit: scale.densityPerUnit,
      cellSizeKm: scale.cellSizeKm,
      lodThresholdsKm: scale.lodThresholdsKm,
      bleedFraction: { rocks: 0.01, dust: 0.03 },
      dustNearFadeFraction: 0.25,
      ringGapsFromTexture: false,
      planetshineStrength: 0,
      layerShadowStrength: 0,
      spinPeriodHours: p.spinPeriodHours,
      // Разреженный пояс: многие секторы 0 < weighted < 1 — без розыгрыша
      // теряли бы камень гарантированно (см. SectorGridConfig.stochasticCount)
      stochasticCount: true,
      // Явно из уже резолвленных параметров пояса (this.params) — единственный
      // источник, а не повторное чтение renderingObject.data в __modelVisualOverrides
      asteroidSizeKm: p.asteroidSizeKm,
      profile: asteroidProfileNameOf(p.profile)
    }
    // Пыль уже посчитана дальним слоем — второй объём стримера был бы дублем
    if (this.dustVolume) overrides.dustEnabled = false

    return new AsteroidRingSystem(this.actor, overrides, this.depthVolumeRegistry, shapeModelStorage)
  }

  public updateObject(ctx: UpdateContext): void {
    this.updateWorldMatrix(true, false)

    const camera = ctx.camera
    this._cameraLocal.copy(camera.getWorldPosition(this._worldPos))
    this.worldToLocal(this._cameraLocal)

    const distance = distanceToTorus(this._cameraLocal, this.innerRadiusTu, this.outerRadiusTu, this.halfThicknessTu)
    this.lodState = nextState(
      this.lodState,
      distance,
      { near: this.nearThresholdTu, mid: this.midThresholdTu },
      0.1
    )

    if (this.lodState === BeltLodState.Near && !this.streamer) {
      this.streamer = this.__createStreamer()
      this.add(this.streamer)
    }

    if (this.streamer) {
      this.streamer.visible = this.lodState === BeltLodState.Near
    }

    if (this.dustVolume) {
      // Звезда в нуле мира (см. resolveLightSource); пояс стоит там же, поэтому
      // направление на неё берётся от камеры — см. ringLightDirection
      this._localLightDir.set(0, 0, 0)
      this.worldToLocal(this._localLightDir)
      ringLightDirection(this._localLightDir, this._cameraLocal, this._localLightDir)
      this.dustVolume.updatePerFrame(this._cameraLocal, this._localLightDir)
    }
  }

  public dispose(): void {
    this.dustVolume?.dispose()
    this.pointLayer.dispose()
  }
}

export { AsteroidBelt }
