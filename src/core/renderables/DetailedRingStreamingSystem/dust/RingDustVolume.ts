import { Color, Mesh, SphereGeometry, type Texture, type Vector2, Vector3 } from 'three'
import { RingDustRaymarchMaterial } from './RingDustRaymarchMaterial'
import type { RingDustRegistry } from '@/core/services/RingDustRegistry'
import type { Disposable } from '@/core/lifecycle/Disposable'

/**
 * Слой графа сцены для объёмов пыли. Основной RenderPass рисует слой 0 камеры
 * и гало не видит; его рисует RingDustPass после сцены, включая этот слой на
 * камере только на время своего рендера (марш режется по глубине сцены).
 */
const RING_DUST_LAYER = 30

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
  /**
   * Реестр пасса RingDustPass: объём регистрируется при создании и снимается в
   * dispose(). Без реестра объём в графе есть, но не рисуется (пасс о нём не
   * знает) — режим тестов и автономных сцен.
   */
  registry?: RingDustRegistry
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
 * RingDustPass: лежит на слое RING_DUST_LAYER и числится в реестре пасса.
 */
class RingDustVolume extends Mesh implements Disposable {
  public readonly dustMaterial: RingDustRaymarchMaterial

  private registry: RingDustRegistry | null

  public constructor(config: RingDustVolumeConfig) {
    const geometry = new SphereGeometry(config.outerRadius * RADIAL_PADDING, 32, 16)

    const material = new RingDustRaymarchMaterial()
    super(geometry, material)

    this.dustMaterial = material
    this.layers.set(RING_DUST_LAYER)

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

  /**
   * Привязка глубины сцены перед рендером пассом: копия depth-текстуры,
   * разрешение таргета (экранная координата → uv) и log2(far + 1) камеры для
   * декода логарифмической глубины three.
   */
  public bindSceneDepth(sceneDepth: Texture, resolution: Vector2, logFarFactor: number): void {
    const u = this.dustMaterial.uniforms
    u.uSceneDepth.value = sceneDepth
    u.uResolution.value.copy(resolution)
    u.uLogFarFactor.value = logFarFactor
  }

  /** Снимает объём с реестра пасса. Идемпотентно; геометрию и материал освобождает обход дерева */
  public dispose(): void {
    this.registry?.unregister(this)
    this.registry = null
  }
}

export { RingDustVolume, DUST_SLAB_FACTOR, RING_DUST_LAYER }
export type { RingDustVolumeConfig }
