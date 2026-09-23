import { Color, Mesh, SphereGeometry, type Texture, type Vector2, Vector3 } from 'three'
import { RingDustRaymarchMaterial } from './RingDustRaymarchMaterial'
import { createDustAngularTexture, createDustRadialTexture } from './DustRadialProfile'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import type { Disposable } from '@/core/lifecycle/Disposable'
import { DEPTH_VOLUME_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'
import type { Actor } from '@/core/models/Actor'

/**
 * Множитель вертикальной оболочки в единицах H — константа обрезки марша в
 * шейдере (|y| <= 12H, за ней плотность пренебрежима). С прокси-сферой на
 * геометрию больше не влияет, но остаётся единым источником этого числа для
 * шейдера и тестов точности (RingDustTauAccuracy.spec.ts).
 */
const DUST_SLAB_FACTOR = 12

/** Радиальный запас охватывающей сферы относительно внешнего радиуса кольца */
const RADIAL_PADDING = 1.05

interface RingDustVolumeConfig {
  /** Внутренний радиус кольца камней, three-units */
  innerRadius: number
  /** Внешний радиус кольца камней, three-units */
  outerRadius: number
  /** Масштабная полутолщина пылевого слоя H, three-units */
  dustScaleHeight: number
  /** Оптическая плотность в средней плоскости, tau на three-unit */
  dustDensity: number
  /** Цвет дымки */
  dustColor: Color
  /** Крутизна гейта по углу обзора */
  anglePower: number
  /** Дистанция полного проявления пыли, three-units */
  nearFade: number
  /** Бюджет шагов марша */
  maxSteps: number
  /** Радиус планеты для тени, three-units (0 — тень выключена) */
  planetRadius: number
  /** Актор кольца — вход подписки на цвет света звезды (lightTint); undefined — тинт выключен. */
  model?: Actor
  /** Светило в начале ring-local (пояс): прямой лепесток по точке марша, см. RingDustRaymarchOptions */
  lightAtOrigin?: boolean
  /** Сила клочьев 0..1; 0 или не задано — модуляция выключена (дефайн не ставится) */
  clumpStrength?: number
  /** Масштаб шума клочьев, three-units (см. precision-заметку в RingDustRaymarchMaterial) */
  clumpScale?: number
  /** Асимметрия фазы HG, [-1, 1); по умолчанию 0.55 */
  phaseG?: number
  /** Сила подмеса фазы 0..1; 0 или не задано — эффект выключен (дефайн не ставится) */
  phaseStrength?: number
  /** Цвет дымки на форвард-пике (взгляд на звезду); по умолчанию = dustColor */
  colorForward?: Color
  /** Доля τ, гасящая фон за дымкой, 0..1; 0 или не задано — аддитивная дымка без поглощения (опция не ставится) */
  extinction?: number
  /**
   * Радиальный профиль плотности пыли (бины ≥ 0 по u = (r − inner)/(outer − inner));
   * без него модуляция выключена. Кольцо получает его позже из альфы текстуры.
   */
  radialProfile?: Float32Array
  /**
   * Азимутальный профиль плотности (дуги пояса, buildBeltAngularProfile: бины
   * по долям оборота от atan2(z, x)); без него модуляция по углу выключена
   * (дефайн не ставится). Кольца его не задают.
   */
  angularProfile?: Float32Array
  /**
   * Реестр пасса DepthVolumePass: объём регистрируется при создании и снимается в
   * dispose(). Без реестра объём в графе есть, но не рисуется (пасс о нём не
   * знает) — режим тестов и автономных сцен.
   */
  registry?: DepthVolumeRegistry
}

/**
 * RingDustVolume — прокси-гало пылевой дымки кольца.
 *
 * Прокси — ОХВАТЫВАЮЩАЯ СФЕРА радиуса outerRadius·padding, центрированная в
 * центре кольца; материал рендерит backface'ы, интегрируя дымку вдоль луча
 * камера→направление. Сфера покрывает проекцию кольца из любого ракурса
 * (снаружи — диск сферы, изнутри — весь экран), поэтому гало не ограничено
 * силуэтом прокси, как было с тонкой шайбой. Сфера симметрична — поворот в
 * ring-local не нужен, mesh-local (XZ-плоскость, нормаль Y) совпадает с
 * ring-local space родительской системы.
 *
 * Живёт в графе сцены (матрицы считает основной проход), но рисуется пассом
 * DepthVolumePass: лежит на слое DEPTH_VOLUME_LAYER и числится в реестре пасса.
 */
class RingDustVolume extends Mesh implements DepthVolume, Disposable {
  public readonly dustMaterial: RingDustRaymarchMaterial
  /** Радиус описанной сферы прокси (см. DepthVolume.boundingRadius) */
  public readonly boundingRadius: number

  private registry: DepthVolumeRegistry | null

  public constructor(config: RingDustVolumeConfig) {
    const geometry = new SphereGeometry(config.outerRadius * RADIAL_PADDING, 32, 16)

    const clumps = (config.clumpStrength ?? 0) > 0
    const phaseHG = (config.phaseStrength ?? 0) > 0
    // Кламп [0, 1]: при k ≤ 1 гашение не превышает добавленный свет, ранний
    // выход по alpha < 0.003 остаётся безопасным
    const extinctionStrength = Math.min(1, Math.max(0, config.extinction ?? 0))
    const extinction = extinctionStrength > 0
    // Текстура дуг строится до материала: вырожденный профиль (null) не ставит дефайн
    const angular = config.angularProfile ? createDustAngularTexture(config.angularProfile) : null
    const material = new RingDustRaymarchMaterial(config.model, {
      lightAtOrigin: config.lightAtOrigin ?? false,
      clumps,
      phaseHG,
      extinction,
      arcs: angular !== null
    })
    super(geometry, material)
    this.boundingRadius = config.outerRadius * RADIAL_PADDING

    this.dustMaterial = material
    this.layers.set(DEPTH_VOLUME_LAYER)

    this.registry = config.registry ?? null
    this.registry?.register(this)
    this.dustMaterial.uniforms.uDustColor.value.copy(config.dustColor)
    this.dustMaterial.uniforms.uDustDensity.value = config.dustDensity
    this.dustMaterial.uniforms.uDustScaleHeight.value = config.dustScaleHeight
    this.dustMaterial.uniforms.uDustRingInner.value = config.innerRadius
    this.dustMaterial.uniforms.uDustRingOuter.value = config.outerRadius
    this.dustMaterial.uniforms.uDustAnglePower.value = config.anglePower
    this.dustMaterial.uniforms.uDustNearFade.value = config.nearFade
    this.dustMaterial.uniforms.uDustMaxSteps.value = config.maxSteps
    this.dustMaterial.uniforms.uDustPlanetRadius.value = config.planetRadius
    this.dustMaterial.uniforms.uDustClumpStrength.value = config.clumpStrength ?? 0
    this.dustMaterial.uniforms.uDustClumpScale.value = config.clumpScale ?? 1
    this.dustMaterial.uniforms.uDustPhaseG.value = config.phaseG ?? 0.55
    this.dustMaterial.uniforms.uDustPhaseStrength.value = config.phaseStrength ?? 0
    this.dustMaterial.uniforms.uDustColorForward.value.copy(config.colorForward ?? config.dustColor)
    this.dustMaterial.uniforms.uDustExtinction.value = extinctionStrength

    const radial = config.radialProfile ? createDustRadialTexture(config.radialProfile) : null
    if (radial) {
      this.dustMaterial.uniforms.uDustRadialMap.value = radial.texture
      this.dustMaterial.uniforms.uDustRadialMapScale.value = radial.scale
    }
    if (angular) {
      this.dustMaterial.uniforms.uDustAngularMap.value = angular.texture
      this.dustMaterial.uniforms.uDustAngularMapScale.value = angular.scale
    }

    // Порядок относительно 2D-текстуры кольца и камней задаёт не renderOrder,
    // а сам пасс: гало рисуется после всей сцены, поверх готового кадра

    // Прокси окружает камеру при полёте внутри кольца — bounding-сферой не отсечь
    this.frustumCulled = false
    this.name = 'RingDustVolume'
  }

  /** Пер-кадровое обновление: камера и направление на звезду в ring-local space */
  public updatePerFrame(camRingPos: Vector3, lightDirRing: Vector3): void {
    this.dustMaterial.uniforms.uDustCamRingPos.value.copy(camRingPos)
    this.dustMaterial.uniforms.uDustLightDirRing.value.copy(lightDirRing)
  }

  /** Привязка глубины сцены перед рендером пассом (контракт DepthVolume) */
  public bindSceneDepth(sceneDepth: Texture, resolution: Vector2, logFarFactor: number): void {
    const u = this.dustMaterial.uniforms
    u.uSceneDepth.value = sceneDepth
    u.uResolution.value.copy(resolution)
    u.uLogFarFactor.value = logFarFactor
    u.uSceneDepthEnabled.value = 1
  }

  public unbindSceneDepth(): void {
    this.dustMaterial.uniforms.uSceneDepthEnabled.value = 0
  }

  /** Снимает объём с реестра пасса. Идемпотентно; геометрию и материал освобождает обход дерева */
  public dispose(): void {
    this.registry?.unregister(this)
    this.registry = null
  }
}

export { RingDustVolume, DUST_SLAB_FACTOR }
export type { RingDustVolumeConfig }
