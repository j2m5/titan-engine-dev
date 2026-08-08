import { EARTH_SOLAR, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'

/**
 * Заготовки renderingObject.data по категориям.
 *
 * Поле data — свободный JSON: схема БД не различает конфиги по категориям,
 * поэтому новая запись раньше начиналась с дефолта планеты, который для
 * кольца или туманности приходилось стирать и набирать блоб руками.
 *
 * Шаблоны обязаны проходить валидатор — это закреплено тестом.
 */

export interface DataTemplate {
  /** ключ опции селекта */
  value: string
  /** подпись в селекте */
  label: string
  data: unknown
}

export const renderingDataTemplates: DataTemplate[] = [
  {
    value: 'planet',
    label: 'planet',
    data: { emission: 1, bumpScale: 0 }
  },
  {
    value: 'ring',
    label: 'ring',
    data: {
      innerRadius: 74500,
      outerRadius: 140220,
      alphaTest: 0.2,
      asteroidDensityScale: 1,
      thicknessKm: 400,
      asteroidSizeKm: 10,
      profile: 'stony',
      ringGapBleedKm: 300,
      dustBleedKm: 600,
      dustEnabled: true,
      dustColor: '#9b968c',
      dustTauGrazing: 0.52,
      dustScaleHeightKm: 200
    }
  },
  {
    value: 'atmosphere',
    label: 'atmosphere',
    // Землеподобный набор: bottomRadius обязан совпасть с радиусом
    // родительской планеты, иначе атмосфера отлипнет от горизонта
    data: {
      solarIrradiance: EARTH_SOLAR,
      sunAngularRadius: 0.004675,
      bottomRadius: 6360,
      topRadius: 6420,
      rayleighDensity: [EMPTY_LAYER, expLayer(8)],
      rayleighScattering: [0.005802, 0.013558, 0.0331],
      mieDensity: [EMPTY_LAYER, expLayer(1.2)],
      mieScattering: [0.003996, 0.003996, 0.003996],
      mieExtinction: [0.00444, 0.00444, 0.00444],
      miePhaseFunctionG: 0.8,
      absorptionDensity: [EMPTY_LAYER, expLayer(15)],
      absorptionExtinction: [0.00065, 0.001881, 0.000085],
      groundAlbedo: [0.1, 0.1, 0.1],
      muSMin: -0.207912,
      exposure: 10,
      hdrKnee: 1
    }
  },
  {
    value: 'nebula',
    label: 'nebula',
    data: {
      preset: 'emission',
      seed: 1337,
      size: 300,
      shape: 'ellipsoid',
      axisRatios: [1, 0.8, 1],
      edgeFalloff: 0.35,
      density: 0.5,
      noise: { contrast: 1.6, worleyStrength: 0.4, ridged: 0.4 },
      palette: {
        stops: [
          { t: 0, color: '#06141c' },
          { t: 0.45, color: '#1f6b66' },
          { t: 0.8, color: '#4cbfa6' },
          { t: 1, color: '#bdeede' }
        ],
        secondary: '#5aa0d8',
        secondaryThreshold: 0.6,
        emissiveIntensity: 1.6
      },
      dust: { strength: 0.6, threshold: 0.55, color: '#05090c' }
    }
  },
  {
    value: 'brownDwarf',
    label: 'brownDwarf',
    data: {
      seed: 4096,
      bandCount: 4.5,
      turbulence: 1.6,
      opticalDepth: 3,
      gapGlow: 3.3,
      gapThreshold: 0.42,
      parallax: 0.02,
      breathAmplitude: 0.08,
      bandWarp: 0.16,
      zonalShear: 0.5,
      fineDetail: 0.25,
      polarChaos: 0.8,
      vortexStrength: 0.35
    }
  }
]
