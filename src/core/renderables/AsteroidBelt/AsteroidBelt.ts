import { Color, Group, Vector3 } from 'three'
import type { Actor } from '@/core/models/Actor'
import type { UpdateContext } from '@/core/UpdateContext'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { toThreeJSUnits, fromAstronomicalUnits } from '@/core/helpers/scaling'
import { asteroidBeltParameters, type AsteroidBeltParameters } from './AsteroidBeltParameters'
import { AsteroidRingSystem, type AsteroidRingConfig } from '@/core/renderables/DetailedRingStreamingSystem'
import { shapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import { deriveCascades, PIXEL_RAD, type CascadeSpec } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'
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
  /** Каскады классов размеров — считаются один раз, используются и порогом Near, и стримером */
  private readonly cascades: readonly CascadeSpec[]

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

    this.cascades = deriveCascades({
      sizeRangeKm: this.params.sizeRangeKm,
      spacingKm: this.params.spacingKm,
      halfThicknessKm: this.params.thicknessKm * 0.5
    })
    // Порог Near — радиус заселения САМОГО КРУПНОГО каскада: у порога до тора
    // меньше него пояс виден как отдельные камни, дальше — уже не имеет смысла
    // держать пул
    // Порог берётся у самого дальнобойного каскада ровно тем же полем, каким
    // стример кормит билборд (uMaxDistance): через радиус заселения они совпали
    // бы только пока порог билборда равен радиусу. Умышленно только САМЫЙ
    // КРУПНЫЙ каскад — точки гаснут одним общим порогом на весь пояс, тогда
    // как билборды внутри стримера теперь фейдятся каждый по порогу СВОЕГО
    // каскада (см. BillboardAsteroidMaterial, instanceMaxDistance); порог точек
    // с этим не связан и не меняется.
    this.nearThresholdTu = toThreeJSUnits(this.cascades[this.cascades.length - 1].lodThresholdsKm.l1)

    this.dustVolume = this.params.dustEnabled ? this.__createDustVolume() : null
    if (this.dustVolume) this.add(this.dustVolume)

    this.pointLayer = this.__createPointLayer()
    this.add(this.pointLayer)

    this.name = 'AsteroidBelt'
  }

  private __createDustVolume(): RingDustVolume {
    const p = this.params
    // Доля полутолщины тора, а не абсолютные км — масштабно-инвариантно для пояса
    const dustScaleHeight = p.dustScaleHeightFraction * this.halfThicknessTu
    // Калибровка ПО ВЕРТИКАЛИ: ∫exp(−|y|/H)dy = 2H, так что толща сквозь слой
    // сверху в средней плоскости равна плотность·2H. Кольцевая калибровка на
    // просвет через ширину (десятки а.е.) делала бы ленту невидимой сверху
    const dustDensity = p.dustTauVertical / (2 * dustScaleHeight)

    return new RingDustVolume({
      innerRadius: this.innerRadiusTu,
      outerRadius: this.outerRadiusTu,
      dustScaleHeight,
      dustDensity,
      dustColor: new Color(p.dustColor),
      // Угловой гейт колец (дымка только на просвет с ребра) поясу не нужен:
      // толстый слой обязан читаться и сверху. Не ровно 0: pow(0, 0) в GLSL
      // не определён для луча строго в надир; 1e-6 даёт единицу всюду
      anglePower: 1e-6,
      // Ближнее гашение — доля толщины пояса, как у стримера (dustNearFadeFraction)
      nearFade: 0.25 * toThreeJSUnits(p.thicknessKm),
      maxSteps: 16,
      planetRadius: 0,
      model: this.actor,
      // Звезда в начале координат пояса: лепесток дымки — по точке марша
      lightAtOrigin: true,
      radialProfile: this.densityProfile,
      // Клочья: низкочастотный шум плотности — лента мятая, с просветами и
      // сгустками, а не ровный градиент; 0 — ровная лента и прежний шейдер
      clumpStrength: p.dustClumpStrength,
      clumpScale: toThreeJSUnits(p.dustClumpScaleKm),
      // Фазовый свет: на просвет к звезде дымка ярче и теплее, спиной — тусклее;
      // среднее по углам не меняется
      phaseG: p.dustPhaseG,
      phaseStrength: p.dustPhaseStrength,
      colorForward: new Color(p.dustColorForward),
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
      // Размер точки — физический: типичное тело крупнейшего класса в единицах
      // сцены на один пиксель. Так точка продолжает билборд ровно с одного
      // пикселя на его пороге и честно тает дальше; ручка — множитель поверх
      pointScale: (toThreeJSUnits(this.cascades[this.cascades.length - 1].typicalSizeKm) / PIXEL_RAD) * p.pointScale,
      // Тот же порог, что уходит билборду L1 как uMaxDistance — см. BeltPointsShaderTemplate
      maxDistance: this.nearThresholdTu
    })
  }

  private __createStreamer(): AsteroidRingSystem {
    const p = this.params

    const overrides: Partial<AsteroidRingConfig> = {
      innerRadiusKm: p.innerRadiusKm,
      outerRadiusKm: p.outerRadiusKm,
      thicknessKm: p.thicknessKm,
      planetRadiusKm: 0,
      frame: 'system',
      relativeOrigin: true,
      densityProfileSource: this.densityProfile,
      cascades: this.cascades as CascadeSpec[],
      // Габарит общий на пул: геометрия архетипа и масштаб карт деталей одни на
      // все каскады, класс задаётся окном minScale/maxScale (см. cascadeScale)
      asteroidSizeKm: p.sizeRangeKm[1],
      sizeExponent: p.sizeExponent,
      // Доля полутолщины тора, как у дальнего слоя пыли (__createDustVolume) — km для конфига кольца
      dustScaleHeightKm: p.dustScaleHeightFraction * (p.thicknessKm * 0.5),
      bleedFraction: { rocks: 0.01, dust: 0.03 },
      dustNearFadeFraction: 0.25,
      ringGapsFromTexture: false,
      planetshineStrength: 0,
      layerShadowStrength: 0,
      spinPeriodHours: p.spinPeriodHours,
      // Разреженный пояс: многие секторы 0 < weighted < 1 — без розыгрыша
      // теряли бы камень гарантированно (см. SectorGridConfig.stochasticCount)
      stochasticCount: true,
      profile: asteroidProfileNameOf(p.profile),
      // Ручки взгляда владельца (стартовые значения 1.35/0.8, тюнятся из данных):
      // cullFovScale расширяет конус отсечения — секторы вокруг кадра готовы
      // заранее, поворот камеры не встречает пустоту; fadeSeconds растягивает
      // проявление сектора — тело в 25 км не всплывает за 0.25 с.
      cullFovScale: p.cullFovScale,
      fadeSeconds: p.fadeSeconds
    }
    // Пыль уже посчитана дальним слоем — второй объём стримера был бы дублем
    if (this.dustVolume) overrides.dustEnabled = false
    // Воздушная перспектива на камнях без объёма: художественная ручка, при
    // толще ленты в сотые доли честная дымка внутри ничтожна. Цвет пыли и
    // выключенный угловой гейт — те же, что у объёма
    if (p.rockFogRangeKm > 0) {
      overrides.rockFog = { rangeKm: p.rockFogRangeKm, nearFadeFraction: 0.05 }
      overrides.dustColor = p.dustColor
      overrides.dustAnglePower = 1e-6
    }

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
