import { Color, Mesh, SphereGeometry, Vector3 } from 'three'
import { RingDustRaymarchMaterial } from './RingDustRaymarchMaterial'

/**
 * Множитель вертикальной оболочки в единицах H — константа обрезки марша в
 * шейдере (|y| <= 12H, за ней плотность пренебрежима). С прокси-сферой на
 * геометрию больше не влияет, но остаётся единым источником этого числа для
 * шейдера и тестов точности (RingDustTauAccuracy.spec.ts).
 */
const DUST_SLAB_FACTOR = 12

/** renderOrder гало пыли: поверх 2D-текстуры кольца (0) и атмосферы */
const DUST_RENDER_ORDER = 2

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
 */
class RingDustVolume extends Mesh {
  public readonly dustMaterial: RingDustRaymarchMaterial

  public constructor(config: RingDustVolumeConfig) {
    const geometry = new SphereGeometry(config.outerRadius * RADIAL_PADDING, 32, 16)

    const material = new RingDustRaymarchMaterial()
    super(geometry, material)

    this.dustMaterial = material
    this.dustMaterial.uniforms.uDustColor.value.copy(config.dustColor)
    this.dustMaterial.uniforms.uDustDensity.value = config.dustDensity
    this.dustMaterial.uniforms.uDustScaleHeight.value = config.dustScaleHeight
    this.dustMaterial.uniforms.uDustRingInner.value = config.innerRadius
    this.dustMaterial.uniforms.uDustRingOuter.value = config.outerRadius
    this.dustMaterial.uniforms.uDustAnglePower.value = config.anglePower
    this.dustMaterial.uniforms.uDustNearFade.value = config.nearFade
    this.dustMaterial.uniforms.uDustMaxSteps.value = config.maxSteps

    // Политика сортировки прозрачных (спека): объём рисуется поверх
    // 2D-текстуры кольца и атмосферы — дистанционная сортировка даёт tie
    // у концентрических объектов, порядок фиксируется явно
    this.renderOrder = DUST_RENDER_ORDER

    // Прокси окружает камеру при полёте внутри кольца — bounding-сферой не отсечь
    this.frustumCulled = false
    this.name = 'RingDustVolume'
  }

  /** Пер-кадровое обновление: камера и направление на звезду в ring-local space */
  public updatePerFrame(camRingPos: Vector3, lightDirRing: Vector3): void {
    this.dustMaterial.uniforms.uDustCamRingPos.value.copy(camRingPos)
    this.dustMaterial.uniforms.uDustLightDirRing.value.copy(lightDirRing)
  }
}

export { RingDustVolume, DUST_SLAB_FACTOR, DUST_RENDER_ORDER }
export type { RingDustVolumeConfig }
