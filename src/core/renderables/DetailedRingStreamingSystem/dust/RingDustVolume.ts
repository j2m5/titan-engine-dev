import { Color, Mesh, Vector3 } from 'three'
import { VolumetricRingGeometry } from '@/geometries/VolumetricRingGeometry'
import { RingDustRaymarchMaterial } from './RingDustRaymarchMaterial'

/**
 * Полутолщина прокси-оболочки в единицах H.
 * Определяет только ПОКРЫТИЕ пикселей (какие фрагменты запускают шейдер):
 * интеграл в шейдере аналитический и от толщины оболочки не зависит.
 *
 * ВАЖНО: на грейзинг-лучах вдоль кольца хвост экспоненты усиливается длиной
 * пути (~120 юнитов), поэтому 6H мало: на кромке оболочки оставалось ~4%
 * альфы — видимый обрез ("грани коробки", скрины n1-n3). При 12H остаточная
 * альфа на кромке ~0.01% — невидима (регрессия покрытия в
 * RingDustTauAccuracy.spec.ts).
 */
const DUST_SLAB_FACTOR = 12

/** renderOrder объёма пыли: поверх 2D-текстуры кольца (0) и атмосферы */
const DUST_RENDER_ORDER = 2

/** Радиальный запас прокси-оболочки относительно кольца камней */
const RADIAL_PADDING = 1.03

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
 * RingDustVolume — прокси-объём пылевой дымки кольца.
 *
 * Оболочка VolumetricRingGeometry чуть толще и шире слоя камней; материал
 * рендерит backface'ы, интегрируя дымку вдоль луча камера→фрагмент.
 * Поворот из плоскости XY (геометрия) в плоскость кольца XZ запечён в вершины,
 * поэтому mesh-local space совпадает с ring-local space родительской системы.
 */
class RingDustVolume extends Mesh {
  public readonly dustMaterial: RingDustRaymarchMaterial

  public constructor(config: RingDustVolumeConfig) {
    const geometry = new VolumetricRingGeometry(
      config.innerRadius / RADIAL_PADDING,
      config.outerRadius * RADIAL_PADDING,
      128,
      config.dustScaleHeight * DUST_SLAB_FACTOR * 2
    )
    geometry.rotateX(Math.PI / 2)

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

    // Оболочка окружает камеру при полёте внутри кольца — сферой отсечения не отсечь
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
