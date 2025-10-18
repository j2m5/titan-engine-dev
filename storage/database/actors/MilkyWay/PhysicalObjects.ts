import { IPhysicalObject } from '@/core/models/types'
import { JupiterMass, JupiterRadius, SolarMass, SolarRadius } from '@/core/constants'
import { SolarSystemPhysicalObjects } from './SolarSystem/PhysicalObjects.ts'

const TOI519PhysicalObjects: IPhysicalObject[] = [
  {
    id: 16,
    actorId: 21,
    parentId: null,
    mass: SolarMass * 0.372,
    radius: SolarRadius * 0.3578,
    axialTilt: 0,
    orbitalPeriod: 0,
    rotationPeriod: 10,
    temperature: 3354
  },
  {
    id: 17,
    actorId: 22,
    parentId: 16,
    mass: JupiterMass * 0.463,
    radius: JupiterRadius * 0.209,
    axialTilt: 15.5,
    orbitalPeriod: 1.3,
    rotationPeriod: 1.3,
    temperature: 0
  }
]

const SolarPhysicalObjects: IPhysicalObject[] = [...SolarSystemPhysicalObjects]

export const PhysicalObjects: IPhysicalObject[] = [...TOI519PhysicalObjects, ...SolarPhysicalObjects]
