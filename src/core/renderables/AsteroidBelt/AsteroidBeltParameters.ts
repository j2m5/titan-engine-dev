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
const DEFAULT_POINT_SCALE = 220

/**
 * Параметры пояса после дефолтов и клампов — км и единицы данных, готовые к
 * передаче в AsteroidBelt/AsteroidRingSystem. Машинерия (LOD-пороги, пулы,
 * сетка) сюда не входит — она выводится из meanSpacingKm отдельно
 * (см. deriveStreamerScale).
 */
export interface AsteroidBeltParameters {
  innerRadiusKm: number
  outerRadiusKm: number
  thicknessKm: number
  meanSpacingKm: number
  asteroidSizeKm: number
  profile: string
  seed: number
  structure: BeltStructure
  dustEnabled: boolean
  dustColor: number | string
  dustTauGrazing: number
  dustScaleHeightKm: number
  spinPeriodHours: number
  /** Число точек дальнего слоя — целое, ≥ 0 (0 гасит слой видимостью пустого буфера) */
  pointCount: number
  pointScale: number
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

  return {
    innerRadiusKm: innerRadiusAu * AU,
    outerRadiusKm: outerRadiusAu * AU,
    thicknessKm: thicknessAu * AU,
    meanSpacingKm: Math.max(data.meanSpacingKm, 1),
    asteroidSizeKm: data.asteroidSizeKm ?? 10,
    profile: data.profile ?? 'stony',
    seed: data.seed ?? 1,
    structure: data.structure ?? EMPTY_STRUCTURE,
    // Пыль как у колец: те же дефолты, что DEFAULT_CONFIG в AsteroidRingSystem
    dustEnabled: data.dustEnabled ?? true,
    dustColor: data.dustColor ?? 0x9b968c,
    dustTauGrazing: data.dustTauGrazing ?? 0.52,
    dustScaleHeightKm: data.dustScaleHeightKm ?? 200,
    spinPeriodHours: data.spinPeriodHours ?? 0,
    // Целое и не отрицательное — отрицательный/дробный count ломает Float32Array(count * 3)
    pointCount: Math.max(0, Math.floor(data.pointCount ?? DEFAULT_POINT_COUNT)),
    pointScale: data.pointScale ?? DEFAULT_POINT_SCALE
  }
}
