import { IRenderingObject } from '@/core/models/types'
import { JupiterRadius, MoonRadius } from '@/core/constants'
import {
  EMPTY_LAYER,
  expLayer,
  scaleRayleigh,
  solarIrradiance,
  sunAngle
} from '@/core/renderables/Atmosphere/AtmosphereConfig'

const TatooAtmosphereRenderingObjects: IRenderingObject[] = [
  {
    id: 25,
    actorId: 66,
    data: {
      solarIrradiance: solarIrradiance(1.0),
      sunAngularRadius: sunAngle(1.0),
      bottomRadius: 5232,
      topRadius: 5292,
      rayleighDensity: [EMPTY_LAYER, expLayer(8.0)],
      rayleighScattering: [0.005802, 0.013558, 0.0331],
      mieDensity: [EMPTY_LAYER, expLayer(1.2)],
      mieScattering: [0.003996, 0.003996, 0.003996],
      mieExtinction: [0.00444, 0.00444, 0.00444],
      miePhaseFunctionG: 0.8,
      absorptionDensity: [
        { width: 25, expTerm: 0, expScale: 0, linearTerm: 1.0 / 15.0, constantTerm: -2.0 / 3.0 },
        { width: 0, expTerm: 0, expScale: 0, linearTerm: -1.0 / 15.0, constantTerm: 8.0 / 3.0 }
      ],
      absorptionExtinction: [0.00065, 0.001881, 0.000085],
      groundAlbedo: [0.1, 0.1, 0.1],
      muSMin: -0.207912
    }
  },
  {
    id: 26,
    actorId: 67,
    data: {
      solarIrradiance: solarIrradiance(5.2),
      sunAngularRadius: sunAngle(5.2),
      bottomRadius: JupiterRadius + 1.2,
      topRadius: JupiterRadius * 1.2 + 200,
      rayleighDensity: [EMPTY_LAYER, expLayer(25.2)],
      rayleighScattering: scaleRayleigh(0.35),
      mieDensity: [EMPTY_LAYER, expLayer(15.0)],
      mieScattering: [0.006, 0.006, 0.006],
      mieExtinction: [0.008, 0.008, 0.008],
      miePhaseFunctionG: 0.7,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0.0, 0.0, 0.0],
      groundAlbedo: [0.4, 0.36, 0.3],
      muSMin: -0.207912
    }
  },
  {
    id: 27,
    actorId: 68,
    data: {
      solarIrradiance: solarIrradiance(30.07),
      sunAngularRadius: sunAngle(30.07),
      bottomRadius: JupiterRadius * 0.8,
      topRadius: JupiterRadius * 0.8 + 200,
      rayleighDensity: [EMPTY_LAYER, expLayer(21.2)],
      rayleighScattering: scaleRayleigh(0.77),
      mieDensity: [EMPTY_LAYER, expLayer(18.0)],
      mieScattering: [0.005, 0.005, 0.005],
      mieExtinction: [0.006, 0.006, 0.006],
      miePhaseFunctionG: 0.7,
      absorptionDensity: [EMPTY_LAYER, expLayer(20.0)],
      absorptionExtinction: [0.008, 0.0025, 0.0002],
      groundAlbedo: [0.35, 0.45, 0.55],
      muSMin: -0.207912
    }
  },
  {
    id: 28,
    actorId: 69,
    data: {
      solarIrradiance: solarIrradiance(1.524),
      sunAngularRadius: sunAngle(1.524),
      bottomRadius: MoonRadius * 1.3,
      topRadius: MoonRadius * 1.3 + 30,
      rayleighDensity: [EMPTY_LAYER, expLayer(11.1)],
      rayleighScattering: scaleRayleigh(0.0195),
      mieDensity: [EMPTY_LAYER, expLayer(11.0)],
      mieScattering: [0.041, 0.04, 0.037],
      mieExtinction: [0.045, 0.045, 0.045],
      miePhaseFunctionG: 0.76,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0.0, 0.0, 0.0],
      groundAlbedo: [0.25, 0.18, 0.12],
      muSMin: -0.207912
    }
  }
]

const TatooRingsRenderingObjects: IRenderingObject[] = [
  {
    id: 29,
    actorId: 70,
    data: {
      innerRadius: 74500,
      outerRadius: 120220,
      alphaTest: 0.01,
      countParticles: 250000
    }
  }
]

const YavinAtmosphereRenderingObjects: IRenderingObject[] = [
  {
    id: 30,
    actorId: 90,
    data: {
      solarIrradiance: solarIrradiance(5.2),
      sunAngularRadius: sunAngle(5.2),
      bottomRadius: 195550,
      topRadius: 195750,
      rayleighDensity: [EMPTY_LAYER, expLayer(25.2)],
      rayleighScattering: scaleRayleigh(0.35),
      mieDensity: [EMPTY_LAYER, expLayer(15.0)],
      mieScattering: [0.006, 0.006, 0.006],
      mieExtinction: [0.008, 0.008, 0.008],
      miePhaseFunctionG: 0.7,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0.0, 0.0, 0.0],
      groundAlbedo: [0.4, 0.36, 0.3],
      muSMin: -0.207912
    }
  },
  {
    id: 31,
    actorId: 92,
    data: {
      solarIrradiance: solarIrradiance(1.0),
      sunAngularRadius: sunAngle(1.0),
      bottomRadius: 6100,
      topRadius: 6160,
      rayleighDensity: [EMPTY_LAYER, expLayer(8.0)],
      rayleighScattering: [0.005802, 0.013558, 0.0331],
      mieDensity: [EMPTY_LAYER, expLayer(1.2)],
      mieScattering: [0.003996, 0.003996, 0.003996],
      mieExtinction: [0.00444, 0.00444, 0.00444],
      miePhaseFunctionG: 0.8,
      absorptionDensity: [
        { width: 25, expTerm: 0, expScale: 0, linearTerm: 1.0 / 15.0, constantTerm: -2.0 / 3.0 },
        { width: 0, expTerm: 0, expScale: 0, linearTerm: -1.0 / 15.0, constantTerm: 8.0 / 3.0 }
      ],
      absorptionExtinction: [0.00065, 0.001881, 0.000085],
      groundAlbedo: [0.1, 0.1, 0.1],
      muSMin: -0.207912
    }
  }
]

export const RenderingObjects: IRenderingObject[] = [
  ...TatooAtmosphereRenderingObjects,
  ...TatooRingsRenderingObjects,
  ...YavinAtmosphereRenderingObjects
]
