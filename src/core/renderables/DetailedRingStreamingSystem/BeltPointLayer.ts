import { BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial } from 'three'
import { SeededRandom } from './SeededRandom'
import { RadialDensityProfile } from './RadialDensityProfile'
import { BeltPointsShaderTemplate } from '@/core/materials/shaders/lib/BeltPointsShaderTemplate'

/** Гашение отдельной точки у камеры — доли полутолщины пояса (см. uNearFade в шаблоне) */
const NEAR_FADE_HALF_THICKNESS_MULT = 8

/** Базовый масштаб точечного спрайта, пиксель·three-unit (см. идиому StarfieldShaderTemplate); ручка владельца */
const DEFAULT_POINT_SCALE = 220

interface BeltPointLayerParams {
  /** Внутренний радиус тора, three-units */
  innerR: number
  /** Внешний радиус тора, three-units */
  outerR: number
  /** Половина толщины тора, three-units */
  halfThickness: number
  /** Число точек буфера — фиксированный бюджет дальнего слоя (спека §4: 50–100 тыс.) */
  count: number
  seed: number
  /** Радиальный профиль плотности (доли [0,1]) — тот же, что у камней стримера (buildBeltDensityProfile) */
  profile: Float32Array
  /** Базовый цвет породы (см. ASTEROID_PROFILES) */
  color: Color
  /** Подписка светила на цвет света (см. resolveLightTint) */
  lightTint: { active: boolean; color: Color }
}

/**
 * BeltPointLayer — дальний слой пояса астероидов: облако точек по тому же
 * радиальному профилю плотности и треугольному закону высоты, что и камни
 * стримера (см. AsteroidGenerator.generateMatricesGrouped) — щели и сгущения
 * читаются одинаково что вблизи, что издалека.
 *
 * ПОЗИЦИИ АБСОЛЮТНЫЕ во float32 (в отличие от камней стримера, у которых
 * плавающее начало + instanceOrigin): на 50 а.е. шаг квантования ~500 км —
 * для одиночного пикселя дальнего плана незаметно (спека §4), а плавающее
 * начало усложнило бы буфер ради точности, которую всё равно не видно.
 */
class BeltPointLayer extends Points {
  public readonly pointMaterial: ShaderMaterial

  public constructor(params: BeltPointLayerParams) {
    const geometry = BeltPointLayer.__buildGeometry(params)
    const material = BeltPointLayer.__buildMaterial(params)

    super(geometry, material)

    this.pointMaterial = material
    this.name = 'BeltPointLayer'
    // Облако накрывает весь тор — камера может оказаться где угодно внутри радиуса,
    // bounding-сфера точек тут не помощник
    this.frustumCulled = false
  }

  /** Кроссфейд с L1 и общая видимость (см. AsteroidBelt.updateObject, beltCrossFade.pointLayerFade) */
  public setFade(fade: number): void {
    this.pointMaterial.uniforms.uFade.value = fade
    this.visible = fade > 0
  }

  public dispose(): void {
    this.geometry.dispose()
    this.pointMaterial.dispose()
  }

  private static __buildGeometry(params: BeltPointLayerParams): BufferGeometry {
    const { innerR, outerR, halfThickness, count, seed, profile } = params
    const density = new RadialDensityProfile(profile, innerR, outerR)
    const rng = new SeededRandom(seed)

    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      // Радиус — importance sampling по профилю плотности, как у камней стримера
      // (см. AsteroidGenerator.generateMatricesGrouped: this.densityProfile.sampleRadius)
      const r = density.sampleRadius(innerR, outerR, rng.next())
      const theta = rng.range(0, Math.PI * 2)
      // Высота — треугольное распределение (сумма двух uniform), как у камней:
      // пик в средней плоскости, линейный спад к краям
      const y = (rng.next() + rng.next() - 1) * halfThickness

      positions[i * 3] = Math.cos(theta) * r
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = Math.sin(theta) * r

      // Пер-точечный джиттер размера — визуальная неоднородность роя, не влияет на плотность
      sizes[i] = 0.6 + rng.next() * 0.8
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('size', new Float32BufferAttribute(sizes, 1))

    return geometry
  }

  private static __buildMaterial(params: BeltPointLayerParams): ShaderMaterial {
    return new ShaderMaterial({
      defines: { ...(params.lightTint.active && { USE_LIGHT_TINT: '1' }) },
      uniforms: {
        uPointScale: { value: DEFAULT_POINT_SCALE },
        uFade: { value: 1 },
        uNearFade: { value: params.halfThickness * NEAR_FADE_HALF_THICKNESS_MULT },
        uColor: { value: new Color().copy(params.color) },
        uLightColor: { value: new Color(1, 1, 1).copy(params.lightTint.color) }
      },
      vertexShader: BeltPointsShaderTemplate.vertexShader,
      fragmentShader: BeltPointsShaderTemplate.fragmentShader,
      transparent: true,
      depthWrite: false
    })
  }
}

export { BeltPointLayer }
export type { BeltPointLayerParams }
