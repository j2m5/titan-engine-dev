import { IRenderingObject } from '@/core/models/types'
import { JupiterRadius } from '@/core/constants'
import {
  EMPTY_LAYER,
  expLayer,
  scaleRayleigh,
  solarIrradiance,
  sunAngle
} from '@/core/renderables/Atmosphere/AtmosphereConfig'

const TOI519PlanetRenderingObjects: IRenderingObject[] = [
  {
    id: 1,
    actorId: 22,
    data: {
      emission: 1,
      bumpScale: 0
    }
  }
]

const SgrARenderingObjects: IRenderingObject[] = [
  {
    id: 33,
    actorId: 95,
    data: {
      emission: 1,
      bumpScale: 0
    }
  }
]

const TOI519AtmosphereRenderingObjects: IRenderingObject[] = [
  {
    id: 2,
    actorId: 71,
    data: {
      solarIrradiance: solarIrradiance(1.0),
      sunAngularRadius: sunAngle(1.0),
      bottomRadius: JupiterRadius * 0.209,
      topRadius: JupiterRadius * 0.209 + 200,
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

const SolarPlanetRenderingObjects: IRenderingObject[] = [
  {
    id: 3,
    actorId: 32,
    data: {
      emission: 1,
      bumpScale: 0.8
    }
  },
  {
    id: 4,
    actorId: 35,
    data: {
      emission: 1,
      bumpScale: 3
    }
  },
  {
    id: 5,
    actorId: 36,
    data: {
      emission: 1,
      bumpScale: 10
    }
  },
  {
    id: 6,
    actorId: 40,
    data: {
      emission: 1,
      bumpScale: 0.3
    }
  },
  {
    id: 7,
    actorId: 46,
    data: {
      emission: 1,
      bumpScale: 2
    }
  },
  {
    id: 8,
    actorId: 51,
    data: {
      emission: 1,
      bumpScale: 2
    }
  },
  {
    id: 9,
    actorId: 56,
    data: {
      emission: 1,
      bumpScale: 0.2
    }
  },
  {
    id: 10,
    actorId: 57,
    data: {
      emission: 1,
      bumpScale: 3
    }
  }
]

const SolarAtmosphereRenderingObjects: IRenderingObject[] = [
  {
    id: 11,
    actorId: 72,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 6051.8,
      topRadius: 6151.8,
      rayleighDensity: [EMPTY_LAYER, expLayer(15.9)],
      rayleighScattering: [0.0008, 0.0008, 0.0008],
      mieDensity: [EMPTY_LAYER, expLayer(4.0)],
      mieScattering: [0.012, 0.012, 0.012],
      mieExtinction: [0.015, 0.015, 0.015],
      miePhaseFunctionG: 0.153,
      absorptionDensity: [
        { width: 10, expTerm: 0, expScale: 0, linearTerm: 0.1, constantTerm: 0 },
        { width: 0, expTerm: 0, expScale: 0, linearTerm: -0.1, constantTerm: 1.0 }
      ],
      absorptionExtinction: [0.0015, 0.0003, 0.00005],
      groundAlbedo: [0.7, 0.7, 0.6],
      muSMin: -0.207912
    }
  },
  {
    id: 12,
    actorId: 73,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 6360,
      topRadius: 6420,
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
    id: 13,
    actorId: 74,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 3390,
      topRadius: 3450,
      rayleighDensity: [EMPTY_LAYER, expLayer(11.1)],
      rayleighScattering: scaleRayleigh(0.0195),
      mieDensity: [EMPTY_LAYER, expLayer(11.0)],
      mieScattering: [0.05822, 0.04, 0.037],
      mieExtinction: [0.0045, 0.0045, 0.0045],
      miePhaseFunctionG: 0.76,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0.0, 0.0, 0.0],
      groundAlbedo: [0.25, 0.18, 0.12],
      muSMin: -0.207912
    }
  },
  {
    id: 14,
    actorId: 75,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: JupiterRadius,
      topRadius: JupiterRadius + 200,
      rayleighDensity: [EMPTY_LAYER, expLayer(25.2)],
      rayleighScattering: [0.0057, 0.0057, 0.0082],
      mieDensity: [EMPTY_LAYER, expLayer(7)],
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
    id: 15,
    actorId: 76,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 58232,
      topRadius: 58532,
      rayleighDensity: [EMPTY_LAYER, expLayer(7)],
      rayleighScattering: [0.0119, 0.0094, 0.0131],
      mieDensity: [EMPTY_LAYER, expLayer(1)],
      mieScattering: [0.0002, 0.0002, 0.0002],
      mieExtinction: [0.06729, 0.06729, 0.06729],
      miePhaseFunctionG: 0.7,
      absorptionDensity: [EMPTY_LAYER, expLayer(40.0)],
      absorptionExtinction: [0.0003, 0.0001, 0.0005],
      groundAlbedo: [0.45, 0.42, 0.35],
      muSMin: -0.207912
    }
  },
  {
    id: 16,
    actorId: 77,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 25362,
      topRadius: 25562,
      rayleighDensity: [EMPTY_LAYER, expLayer(26.9)],
      rayleighScattering: scaleRayleigh(0.78),
      mieDensity: [EMPTY_LAYER, expLayer(20.0)],
      mieScattering: [0.004, 0.004, 0.004],
      mieExtinction: [0.005, 0.005, 0.005],
      miePhaseFunctionG: 0.7,
      absorptionDensity: [EMPTY_LAYER, expLayer(25.0)],
      absorptionExtinction: [0.005, 0.0015, 0.0001],
      groundAlbedo: [0.45, 0.55, 0.55],
      muSMin: -0.207912
    }
  },
  {
    id: 17,
    actorId: 78,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 24622,
      topRadius: 24822,
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
    id: 18,
    actorId: 79,
    data: {
      solarIrradiance: solarIrradiance(2),
      sunAngularRadius: sunAngle(2),
      bottomRadius: 2575,
      topRadius: 2875,
      rayleighDensity: [EMPTY_LAYER, expLayer(20)],
      rayleighScattering: [0.002, 0.008, 0.04],
      mieDensity: [EMPTY_LAYER, expLayer(2)],
      mieScattering: [0.0002, 0.0002, 0.0002],
      mieExtinction: [0.00022, 0.00022, 0.00022],
      miePhaseFunctionG: 0.7,
      absorptionDensity: [EMPTY_LAYER, expLayer(20.0)],
      absorptionExtinction: [0.0, 0.0, 0.009],
      groundAlbedo: [0.15, 0.1, 0.07],
      muSMin: -0.207912
    }
  },
  {
    id: 19,
    actorId: 83,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 1353.4,
      topRadius: 1453.4,
      rayleighDensity: [EMPTY_LAYER, expLayer(14.5)],
      rayleighScattering: scaleRayleigh(0.00008),
      mieDensity: [EMPTY_LAYER, expLayer(20.0)],
      mieScattering: [0.0003, 0.0003, 0.0003],
      mieExtinction: [0.0004, 0.0004, 0.0004],
      miePhaseFunctionG: 0.5,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0.0, 0.0, 0.0],
      groundAlbedo: [0.7, 0.7, 0.7],
      muSMin: -0.207912
    }
  },
  {
    id: 20,
    actorId: 84,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 1188.3,
      topRadius: 1388.3,
      rayleighDensity: [EMPTY_LAYER, expLayer(21.1)],
      rayleighScattering: scaleRayleigh(0.00006),
      mieDensity: [EMPTY_LAYER, expLayer(20.0)],
      mieScattering: [0.001, 0.0008, 0.0004],
      mieExtinction: [0.00992, 0.00992, 0.00018],
      miePhaseFunctionG: 0.5,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0.0, 0.0, 0.0],
      groundAlbedo: [0.6, 0.55, 0.5],
      muSMin: -0.207912
    }
  },
  {
    id: 21,
    actorId: 85,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
      bottomRadius: 1163,
      topRadius: 1263,
      rayleighDensity: [EMPTY_LAYER, expLayer(14.5)],
      rayleighScattering: scaleRayleigh(0.00008),
      mieDensity: [EMPTY_LAYER, expLayer(20.0)],
      mieScattering: [0.0003, 0.0003, 0.0003],
      mieExtinction: [0.0004, 0.0004, 0.0004],
      miePhaseFunctionG: 0.5,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0.0, 0.0, 0.0],
      groundAlbedo: [0.7, 0.7, 0.7],
      muSMin: -0.207912
    }
  }
]

const SgrAAtmosphereRenderingObjects: IRenderingObject[] = [
  {
    id: 32,
    actorId: 96,
    data: {
      solarIrradiance: solarIrradiance(1),
      sunAngularRadius: sunAngle(1),
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

const SolarRingsRenderingObjects: IRenderingObject[] = [
  {
    id: 22,
    actorId: 80,
    data: {
      innerRadius: 74500,
      outerRadius: 140220,
      alphaTest: 0.2,
      countParticles: 250000
    }
  },
  {
    id: 23,
    actorId: 81,
    data: {
      innerRadius: 38000,
      outerRadius: 58000,
      alphaTest: 0.08,
      countParticles: 250000
    }
  },
  {
    id: 24,
    actorId: 82,
    data: {
      innerRadius: 40900,
      outerRadius: 62932,
      alphaTest: 0.08,
      countParticles: 250000
    }
  }
]

export const RenderingObjects: IRenderingObject[] = [
  ...TOI519PlanetRenderingObjects,
  ...TOI519AtmosphereRenderingObjects,
  ...SolarPlanetRenderingObjects,
  ...SolarAtmosphereRenderingObjects,
  ...SolarRingsRenderingObjects,
  ...SgrARenderingObjects,
  ...SgrAAtmosphereRenderingObjects
]
