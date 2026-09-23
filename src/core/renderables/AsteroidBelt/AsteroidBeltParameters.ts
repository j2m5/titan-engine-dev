import { AU } from '@/core/constants'
import { Actor } from '@/core/models/Actor'
import { requireRenderingData } from '@/core/helpers/renderingData'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import type { BeltStructure } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'

/** Пояс без щелей и сгущений — единица по всей ширине (см. buildBeltDensityProfile) */
const EMPTY_STRUCTURE: BeltStructure = { edgeSoftness: 0, gaps: [], clumps: [] }

/** Дефолты дальнего слоя точек — диапазон спеки §4: 50–100 тыс. точек на буфер */
const DEFAULT_POINT_COUNT = 60000
/** Базовый масштаб точечного спрайта, пиксель·three-unit (см. идиому StarfieldShaderTemplate) */
/** Множитель поверх физического размера точки (типичное тело крупнейшего класса на пиксель) */
const DEFAULT_POINT_SCALE = 1

/**
 * Параметры пояса после дефолтов и клампов — км и единицы данных, готовые к
 * передаче в AsteroidBelt/AsteroidRingSystem. Машинерия (LOD-пороги, пулы,
 * сетка) сюда не входит — она выводится из sizeRangeKm/spacingKm отдельно
 * (см. deriveCascades).
 */
export interface AsteroidBeltParameters {
  innerRadiusKm: number
  outerRadiusKm: number
  thicknessKm: number
  /** Границы размеров тел, км: [мелочь, глыбы] */
  sizeRangeKm: [number, number]
  /** Показатель степенного закона розыгрыша масштаба внутри класса */
  sizeExponent: number
  /** Среднее расстояние между телами самого мелкого класса, км */
  spacingKm: number
  profile: string
  seed: number
  structure: BeltStructure
  dustEnabled: boolean
  dustColor: number | string
  /** Оптическая толща дымки по вертикали сквозь слой в средней плоскости */
  dustTauVertical: number
  /** Доля полутолщины тора — масштабная полутолщина пылевого слоя */
  dustScaleHeightFraction: number
  /** Сила клочьев дымки 0..1; 0 — ровная лента */
  dustClumpStrength: number
  /** Масштаб клочьев дымки, км */
  dustClumpScaleKm: number
  spinPeriodHours: number
  /** Число точек дальнего слоя — целое, ≥ 0 (0 гасит слой видимостью пустого буфера) */
  pointCount: number
  pointScale: number
  /** Запас отсечения секторов вокруг кадра — множитель fov камеры отсечения стримера */
  cullFovScale: number
  /** Длительность проявления сектора стримера, секунды */
  fadeSeconds: number
}

/**
 * Пояс без данных не построить — как у кольца и туманности, отказ до
 * конструирования узла ничего не аллоцирует.
 *
 * Клампы: битые радиусы делят на ноль в профиле плотности и в distanceToTorus,
 * поэтому вход защищён здесь, а не по местам использования.
 */
export function asteroidBeltParameters(actor: Actor): AsteroidBeltParameters {
  const data = requireRenderingData<IAsteroidBeltRenderingObject>(actor, 'AsteroidBelt', 'пояса астероидов')

  const innerRadiusAu = data.innerRadiusAu > 0 ? data.innerRadiusAu : 1
  const outerRadiusAu = data.outerRadiusAu > innerRadiusAu ? data.outerRadiusAu : innerRadiusAu + 1
  const thicknessAu = data.thicknessAu > 0 ? data.thicknessAu : 0.01

  const rawMin = data.sizeRangeKm?.[0]
  const rawMax = data.sizeRangeKm?.[1]
  const sizeMin = typeof rawMin === 'number' && rawMin > 0 ? rawMin : 1
  const sizeMax = typeof rawMax === 'number' && rawMax > sizeMin ? rawMax : sizeMin + 1

  return {
    innerRadiusKm: innerRadiusAu * AU,
    outerRadiusKm: outerRadiusAu * AU,
    thicknessKm: thicknessAu * AU,
    sizeRangeKm: [sizeMin, sizeMax],
    sizeExponent: Math.max(data.sizeExponent ?? 1, 0.1),
    spacingKm: Math.max(data.spacingKm ?? 1, 1),
    profile: data.profile ?? 'stony',
    seed: data.seed ?? 1,
    structure: data.structure ?? EMPTY_STRUCTURE,
    // Пыль как у колец: те же дефолты, что DEFAULT_CONFIG в AsteroidRingSystem
    dustEnabled: data.dustEnabled ?? true,
    dustColor: data.dustColor ?? 0x9b968c,
    // Толща по вертикали, не на просвет через ширину (см. IAsteroidBeltRenderingObject)
    dustTauVertical: Math.max(0, data.dustTauVertical ?? 0.12),
    dustScaleHeightFraction: data.dustScaleHeightFraction ?? 1 / 3,
    dustClumpStrength: Math.min(1, Math.max(0, data.dustClumpStrength ?? 0.7)),
    // Пол ~100 единиц сцены (200 000 км): мельче шум по float32-координатам алиасит
    dustClumpScaleKm: Math.max(1.3e-3, data.dustClumpScaleAu ?? 0.6) * AU,
    spinPeriodHours: data.spinPeriodHours ?? 0,
    // Целое и не отрицательное — отрицательный/дробный count ломает Float32Array(count * 3)
    pointCount: Math.max(0, Math.floor(data.pointCount ?? DEFAULT_POINT_COUNT)),
    pointScale: data.pointScale ?? DEFAULT_POINT_SCALE,
    // Стартовые ручки взгляда владельца — см. AsteroidBelt.__createStreamer.
    // Масштаб меньше единицы СУЖАЛ бы конус отсечения — секторы внутри кадра
    // отсекались бы, в кадре дыры; неположительная длительность — деление на ноль
    cullFovScale: Math.max(1, data.cullFovScale ?? 1.35),
    fadeSeconds: Math.max(0.001, data.fadeSeconds ?? 0.8)
  }
}
