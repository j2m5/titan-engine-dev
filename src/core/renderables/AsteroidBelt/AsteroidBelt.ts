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
 * Дальний слой — пылевая лента (RingDustVolume) поверх всего тора, видна во
 * всех трёх состояниях; при её наличии стример получает dustEnabled: false,
 * чтобы не считать пыль дважды. Точечная россыпь дальнего слоя — Task 7.
 */
class AsteroidBelt extends Group {
  // Не "model": three.js уже объявляет это имя публичным на Object3D (см.
  // TitanThree/three-types.d.ts) — приватное поле того же имени ломает наследование
  private readonly actor: Actor
  private readonly params: AsteroidBeltParameters
  private readonly depthVolumeRegistry: DepthVolumeRegistry | null

  private readonly innerRadiusTu: number
  private readonly outerRadiusTu: number
  private readonly halfThicknessTu: number
  private readonly nearThresholdTu: number
  private readonly midThresholdTu: number = fromAstronomicalUnits(MID_THRESHOLD_AU)

  private lodState: BeltLodState = BeltLodState.Far
  private streamer: AsteroidRingSystem | null = null
  private readonly dustVolume: RingDustVolume | null

  private readonly _cameraLocal = new Vector3()
  private readonly _worldPos = new Vector3()
  private readonly _localLightDir = new Vector3()

  public constructor(model: Actor, depthVolumeRegistry: DepthVolumeRegistry | null = null) {
    super()
    this.actor = model
    this.depthVolumeRegistry = depthVolumeRegistry
    this.params = asteroidBeltParameters(model)

    this.innerRadiusTu = toThreeJSUnits(this.params.innerRadiusKm)
    this.outerRadiusTu = toThreeJSUnits(this.params.outerRadiusKm)
    this.halfThicknessTu = toThreeJSUnits(this.params.thicknessKm) * 0.5

    // Порог Near — l1MaxDistance стримера: у порога до тора меньше него пояс
    // виден как отдельные камни, дальше — уже не имеет смысла держать пул
    this.nearThresholdTu = toThreeJSUnits(deriveStreamerScale(this.params.meanSpacingKm).lodThresholdsKm.l1)

    this.dustVolume = this.params.dustEnabled ? this.__createDustVolume() : null
    if (this.dustVolume) this.add(this.dustVolume)

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
      registry: this.depthVolumeRegistry ?? undefined
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
      densityProfileSource: buildBeltDensityProfile(p.structure),
      densityPerUnit: scale.densityPerUnit,
      cellSizeKm: scale.cellSizeKm,
      lodThresholdsKm: scale.lodThresholdsKm,
      bleedFraction: { rocks: 0.01, dust: 0.03 },
      dustNearFadeFraction: 0.25,
      ringGapsFromTexture: false,
      planetshineStrength: 0,
      layerShadowStrength: 0
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
      // Звезда в нуле системы: мировая точка (0,0,0) переведённая в local даёт
      // направление от центра пояса к светилу (см. resolveLightSource)
      this._localLightDir.set(0, 0, 0)
      this.worldToLocal(this._localLightDir)
      this._localLightDir.normalize()
      this.dustVolume.updatePerFrame(this._cameraLocal, this._localLightDir)
    }
  }

  public dispose(): void {
    this.dustVolume?.dispose()
  }
}

export { AsteroidBelt }
