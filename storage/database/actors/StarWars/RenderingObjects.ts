import { IRenderingObject } from '@/core/models/types'
import { JupiterRadius, MoonRadius } from '@/core/constants'

const TatooAtmosphereRenderingObjects: IRenderingObject[] = [
  {
    id: 25,
    actorId: 66,
    data: {
      radius: 5471,
      scatter: { r: 750, g: 690, b: 580 },
      scatteringStrength: 15,
      densityFalloff: 10
    }
  },
  {
    id: 26,
    actorId: 67,
    data: {
      radius: JupiterRadius * 1.3 + 1500,
      scatter: { r: 650, g: 530, b: 380 },
      scatteringStrength: 10,
      densityFalloff: 10
    }
  },
  {
    id: 27,
    actorId: 68,
    data: {
      radius: JupiterRadius * 0.8 + 1500,
      scatter: { r: 750, g: 690, b: 580 },
      scatteringStrength: 10,
      densityFalloff: 10
    }
  },
  {
    id: 28,
    actorId: 69,
    data: {
      radius: MoonRadius * 1.3 + 200,
      scatter: { r: 750, g: 600, b: 580 },
      scatteringStrength: 20,
      densityFalloff: 10
    }
  }
]

const TatooRingsRenderingObjects: IRenderingObject[] = [
  {
    id: 29,
    actorId: 70,
    data: {
      innerRadius: 74500,
      outerRadius: 140220,
      alphaTest: 0.1,
      countParticles: 250000
    }
  }
]

export const RenderingObjects: IRenderingObject[] = [...TatooAtmosphereRenderingObjects, ...TatooRingsRenderingObjects]
