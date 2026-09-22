import { BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial } from 'three'
import { SeededRandom } from './SeededRandom'
import { RadialDensityProfile } from './RadialDensityProfile'
import { triangularHeight } from './triangularHeight'
import { BeltPointsShaderTemplate } from '@/core/materials/shaders/lib/BeltPointsShaderTemplate'

interface BeltPointLayerParams {
  /** Внутренний радиус тора, three-units */
  innerR: number
  /** Внешний радиус тора, three-units */
  outerR: number
  /** Половина толщины тора, three-units */
  halfThickness: number
  /** Число точек буфера (см. IAsteroidBeltRenderingObject.pointCount, дефолт 60000) */
  count: number
  seed: number
  /** Радиальный профиль плотности (доли [0,1]) — тот же, что у камней стримера (buildBeltDensityProfile) */
  profile: Float32Array
  /** Базовый цвет породы (см. ASTEROID_PROFILES) */
  color: Color
  /** Подписка светила на цвет света (см. resolveLightTint) */
  lightTint: { active: boolean; color: Color }
  /** Базовый масштаб спрайта, пиксель·three-unit (см. IAsteroidBeltRenderingObject.pointScale, дефолт 220) */
  pointScale: number
  /**
   * Порог кроссфейда с L1-биллбордами, three-units — тот же nearThresholdTu
   * (= lodThresholdsKm.l1 стримера), что передаётся билборду как uMaxDistance
   * (см. AsteroidBelt, BillboardAsteroidMaterial). Общий порог — условие
   * того, что fade точки и fade L1 на одной дистанции взаимно дополняют друг
   * друга (см. докблок BeltPointsShaderTemplate).
   */
  maxDistance: number
}

/**
 * BeltPointLayer — дальний слой пояса астероидов: облако точек по тому же
 * радиальному профилю плотности и треугольному закону высоты, что и камни
 * стримера (см. AsteroidGenerator.generateMatricesGrouped, triangularHeight)
 * — щели и сгущения читаются одинаково что вблизи, что издалека.
 *
 * Слой ВСЕГДА видим (в отличие от лениво создаваемого стримера) — кроссфейд с
 * L1-биллбордами считается per-point в вершиннике (см. BeltPointsShaderTemplate),
 * а не общим множителем: разные точки тора могут быть у камеры внутри Near и
 * далеко от неё одновременно.
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
      const y = triangularHeight(rng, halfThickness)

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
        uPointScale: { value: params.pointScale },
        uMaxDistance: { value: params.maxDistance },
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
