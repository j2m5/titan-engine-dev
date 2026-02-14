import { IRenderingObject } from '@/core/models/types'
import { JupiterRadius } from '@/core/constants'
import { hexToRGB } from '@/core/materials/shaders/lib/helpers'

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

const TOI519AtmosphereRenderingObjects: IRenderingObject[] = [
  {
    id: 2,
    actorId: 71,
    data: {
      radius: JupiterRadius * 0.209 * 1.02,
      scatter: { r: 650, g: 530, b: 380 },
      scatteringStrength: 10,
      densityFalloff: 10
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
      radius: 6152,
      scatter: { r: 500, g: 530, b: 600 },
      scatteringStrength: 10,
      densityFalloff: 10
    }
  },
  {
    id: 12,
    actorId: 73,
    data: {
      radius: 6420,
      scatter: { r: 650, g: 490, b: 380 },
      scatteringStrength: 15,
      densityFalloff: 10,
      useNewShader: true
    }
  },
  {
    id: 13,
    actorId: 74,
    data: {
      radius: 3440,
      scatter: { r: 450, g: 500, b: 500 },
      scatteringStrength: 10,
      densityFalloff: 5
    }
  },
  {
    id: 14,
    actorId: 75,
    data: {
      radius: 70911,
      scatter: { r: 650, g: 650, b: 600 },
      scatteringStrength: 10,
      densityFalloff: 10
    }
  },
  {
    id: 15,
    actorId: 76,
    data: {
      radius: 59232,
      scatter: { r: 600, g: 530, b: 440 },
      scatteringStrength: 20,
      densityFalloff: 10
    }
  },
  {
    id: 16,
    actorId: 77,
    data: {
      radius: 25662,
      scatter: { r: 700, g: 530, b: 440 },
      scatteringStrength: 10,
      densityFalloff: 10
    }
  },
  {
    id: 17,
    actorId: 78,
    data: {
      radius: 24922,
      scatter: { r: 650, g: 530, b: 380 },
      scatteringStrength: 10,
      densityFalloff: 10
    }
  },
  {
    id: 18,
    actorId: 79,
    data: {
      radius: 2700,
      scatter: { r: 600, g: 500, b: 440 },
      scatteringStrength: 15,
      densityFalloff: 10
    }
  }
]

const SolarHaloRenderingObjects: IRenderingObject[] = [
  {
    id: 19,
    actorId: 83,
    data: {
      radius: 1400,
      day: hexToRGB('#699de1'),
      night: hexToRGB('#699de1')
    }
  },
  {
    id: 20,
    actorId: 84,
    data: {
      radius: 1250,
      day: hexToRGB('#699de1'),
      night: hexToRGB('#699de1')
    }
  },
  {
    id: 21,
    actorId: 85,
    data: {
      radius: 1200,
      day: hexToRGB('#5897ea'),
      night: hexToRGB('#5897ea')
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
  ...SolarHaloRenderingObjects,
  ...SolarRingsRenderingObjects
]
