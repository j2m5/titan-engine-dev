import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/**
 * Параметры рендеринга чёрной дыры (слой renderingObject.data)
 * Все поля опциональны: минимальная дыра в базе — physicalObject (mass, temperature) + data: {}
 * Радиусы — в километрах, как у остальных объектов проекта
 */
export interface IBlackHoleRenderingObject {
  /** Художественный множитель визуального размера, не влияет на массу. По умолчанию 1 */
  visualScale?: number
  /** Внутренний радиус аккреционного диска, км. По умолчанию вычисляется: 3·rsVisual (ISCO) */
  diskInnerRadius?: number
  /** Внешний радиус аккреционного диска, км. По умолчанию вычисляется: 14·rsVisual */
  diskOuterRadius?: number
  /** Радиус зоны симуляции лензирования (bounding-сфера), км. По умолчанию: max(27·rsVisual, 2·diskOuterRadius) */
  simulationRadius?: number
  /** HDR-множитель эмиссии диска, калибруется под Bloom (порог 1.0). По умолчанию 6 */
  diskIntensity?: number
  /** Масштаб турбулентности диска. По умолчанию 1 */
  diskNoiseScale?: number
  /** Зерно шума диска, даёт разнообразие между дырами. По умолчанию id актора */
  diskNoiseSeed?: number
  /** Сила доплеровской асимметрии, 0..1. По умолчанию 0.6 («как в Interstellar») */
  dopplerStrength?: number
  /** Художественный буст яркости фотонного кольца. По умолчанию 1 */
  photonRingIntensity?: number
}

/** Гравитационная постоянная в СИ, м³/(кг·с²). Проектная G — гауссова и для метрики не годится */
const GRAVITATIONAL_CONSTANT_SI: number = 6.6743e-11
/** Скорость света в СИ, м/с */
const LIGHT_SPEED_SI: number = 2.99792458e8

/** Внутренний радиус диска по умолчанию: ISCO = 3·rs */
const DISK_INNER_FACTOR: number = 3.0
/** Внешний радиус диска по умолчанию: 14·rs */
const DISK_OUTER_FACTOR: number = 14.0
/** Радиус зоны симуляции по умолчанию: 27·rs */
const SIMULATION_FACTOR: number = 27.0
/** Запас зоны симуляции относительно внешнего радиуса диска (касательные лучи изгибаются по дуге) */
const SIMULATION_DISK_MARGIN: number = 2.0
/** Нижний кламп внутреннего радиуса диска: ниже фотонной сферы (1.5·rs) диск не живёт */
const DISK_INNER_MIN_FACTOR: number = 1.6
/** Радиус тени Шварцшильда: √27/2 ≈ 2.598·rs */
const SHADOW_FACTOR: number = Math.sqrt(27) / 2
/** Допустимое относительное расхождение хранимого radius и вычисленного rs */
const STORED_RADIUS_TOLERANCE: number = 0.01

/**
 * Резолвер параметров чёрной дыры — единственный источник правды
 * для uniforms материала и LOD-логики (спецификация §3)
 *
 * Цепочка вывода: mass → rs → rsVisual → радиусы диска и зоны симуляции,
 * каждое звено опционально переопределяется в renderingObject.data
 *
 * Соглашение по единицам:
 *  - поля без суффикса — километры (как в базе данных)
 *  - *Units — единицы Three.js (через toThreeJSUnits)
 *  - *Rs — безразмерные, в единицах rsVisual = 1 (система координат шейдера)
 */
class BlackHoleParameters {
  public readonly model: Actor

  /** Честный радиус Шварцшильда rs = 2GM/c², км. Выводится из массы, не переопределяется */
  public readonly schwarzschildRadius: number
  /** Художественный множитель размера */
  public readonly visualScale: number
  /** Визуальный радиус горизонта rsVisual = rs · visualScale, км. База всех вычислений */
  public readonly rsVisual: number
  /** Радиус тени (чёрного круга) √27/2 · rsVisual, км */
  public readonly shadowRadius: number

  /** Температура диска на внутреннем крае, К. 0 — диска нет */
  public readonly temperature: number
  /** Признак наличия аккреционного диска (temperature > 0) */
  public readonly hasDisk: boolean

  /** Внутренний радиус диска, км (с учётом переопределения и клампа) */
  public readonly diskInnerRadius: number
  /** Внешний радиус диска, км */
  public readonly diskOuterRadius: number
  /** Радиус зоны симуляции, км */
  public readonly simulationRadius: number

  /** Наклон плоскости диска (axialTilt физического слоя), градусы */
  public readonly axialTilt: number
  /** Базовый период вращения диска на внутреннем крае (rotationPeriod физического слоя) */
  public readonly rotationPeriod: number

  public readonly diskIntensity: number
  public readonly diskNoiseScale: number
  public readonly diskNoiseSeed: number
  public readonly dopplerStrength: number
  public readonly photonRingIntensity: number

  public constructor(model: Actor) {
    this.model = model

    const physical = model.physicalObject
    if (!physical) {
      throw new Error(`[BlackHoleParameters] У актора "${model.getAttribute('name')}" отсутствует physicalObject`)
    }

    const data: IBlackHoleRenderingObject = model.renderingObject?.getAttribute('data') ?? {}

    const mass: number = physical.getAttribute('mass')
    this.schwarzschildRadius = BlackHoleParameters.schwarzschildRadiusKm(mass)
    this.visualScale = data.visualScale ?? 1
    this.rsVisual = this.schwarzschildRadius * this.visualScale
    this.shadowRadius = SHADOW_FACTOR * this.rsVisual

    this.temperature = physical.getAttribute('temperature', 0)
    this.hasDisk = this.temperature > 0

    this.axialTilt = physical.getAttribute('axialTilt', 0)
    this.rotationPeriod = physical.getAttribute('rotationPeriod', 1)

    const innerMin: number = DISK_INNER_MIN_FACTOR * this.rsVisual
    let inner: number = data.diskInnerRadius ?? DISK_INNER_FACTOR * this.rsVisual
    if (inner < innerMin) {
      this.warn(`diskInnerRadius ${inner} км ниже фотонной сферы, кламп до ${innerMin} км`)
      inner = innerMin
    }

    let outer: number = data.diskOuterRadius ?? DISK_OUTER_FACTOR * this.rsVisual
    if (outer <= inner) {
      const fixed: number = inner * 2
      this.warn(`diskOuterRadius ${outer} км не превышает внутренний радиус, кламп до ${fixed} км`)
      outer = fixed
    }

    this.diskInnerRadius = inner
    this.diskOuterRadius = outer

    const simulationDefault: number = Math.max(SIMULATION_FACTOR * this.rsVisual, SIMULATION_DISK_MARGIN * outer)
    this.simulationRadius = data.simulationRadius ?? simulationDefault
    if (this.hasDisk && this.simulationRadius < SIMULATION_DISK_MARGIN * outer) {
      this.warn(
        `simulationRadius ${this.simulationRadius} км не вмещает диск с запасом ` +
          `(рекомендуется ≥ ${SIMULATION_DISK_MARGIN * outer} км): внешний край диска ` +
          `будет обрезаться на скользящих ракурсах`
      )
    }

    const storedRadius: number = physical.getAttribute('radius', 0)
    if (storedRadius > 0) {
      const deviation: number = Math.abs(storedRadius - this.schwarzschildRadius) / this.schwarzschildRadius
      if (deviation > STORED_RADIUS_TOLERANCE) {
        this.warn(
          `хранимый radius ${storedRadius} км расходится с вычисленным rs ` +
            `${this.schwarzschildRadius.toFixed(3)} км (инвариант спецификации §2.1)`
        )
      }
    }

    this.diskIntensity = data.diskIntensity ?? 6
    this.diskNoiseScale = data.diskNoiseScale ?? 1
    this.diskNoiseSeed = data.diskNoiseSeed ?? model.getAttribute('id', 0)
    this.dopplerStrength = data.dopplerStrength ?? 0.6
    this.photonRingIntensity = data.photonRingIntensity ?? 1
  }

  /** Радиус Шварцшильда rs = 2GM/c² в километрах из массы в килограммах */
  public static schwarzschildRadiusKm(massKg: number): number {
    return (2 * GRAVITATIONAL_CONSTANT_SI * massKg) / (LIGHT_SPEED_SI * LIGHT_SPEED_SI) / 1000
  }

  // ── Единицы Three.js (для геометрии и LOD) ─────────────────────

  /**
   * Радиус клик-таргета: видимый образ дыры (диск либо удвоенная тень),
   * а не вся зона симуляции — иначе клик по «пустому космосу» вокруг дыры
   * регистрируется как клик по объекту
   */
  public get clickRadiusUnits(): number {
    return toThreeJSUnits(this.hasDisk ? this.diskOuterRadius : 2 * this.shadowRadius)
  }

  public get rsVisualUnits(): number {
    return toThreeJSUnits(this.rsVisual)
  }

  public get shadowRadiusUnits(): number {
    return toThreeJSUnits(this.shadowRadius)
  }

  public get simulationRadiusUnits(): number {
    return toThreeJSUnits(this.simulationRadius)
  }

  // ── Единицы шейдера, rsVisual = 1 (точность float) ─────────────

  public get diskInnerRs(): number {
    return this.diskInnerRadius / this.rsVisual
  }

  public get diskOuterRs(): number {
    return this.diskOuterRadius / this.rsVisual
  }

  public get simulationRs(): number {
    return this.simulationRadius / this.rsVisual
  }

  private warn(message: string): void {
    console.warn(`[BlackHoleParameters] "${this.model.getAttribute('name')}": ${message}`)
  }
}

export { BlackHoleParameters }
