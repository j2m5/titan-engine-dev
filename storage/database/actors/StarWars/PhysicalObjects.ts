import { IPhysicalObject } from '@/core/models/types'
import { JupiterMass, JupiterRadius, MoonMass, MoonRadius, SolarMass, SolarRadius } from '@/core/constants'

const TatooPhysicalObjects: IPhysicalObject[] = [
  {
    id: 1,
    actorId: 4,
    parentId: 53,
    mass: SolarMass * 1.1,
    radius: SolarRadius * 1.2,
    axialTilt: 7.25,
    orbitalPeriod: 6.050707298909615e3,
    rotationPeriod: 10,
    temperature: 5900
  },
  {
    id: 2,
    actorId: 5,
    parentId: 53,
    mass: SolarMass * 0.7,
    radius: SolarRadius * 0.8,
    axialTilt: 7.25,
    orbitalPeriod: 6.050707298909615e3,
    rotationPeriod: 10,
    temperature: 2700
  },
  {
    id: 3,
    actorId: 6,
    parentId: 53,
    mass: 4.868e24,
    radius: 5232.5,
    axialTilt: 24.7,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 4,
    actorId: 7,
    parentId: 53,
    mass: JupiterMass * 1.2,
    radius: JupiterRadius * 1.3,
    axialTilt: 11.16,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 5,
    actorId: 8,
    parentId: 53,
    mass: JupiterMass * 0.4,
    radius: JupiterRadius * 0.8,
    axialTilt: -29.6,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 6,
    actorId: 9,
    parentId: 3,
    mass: MoonMass * 0.3,
    radius: MoonRadius * 0.3,
    axialTilt: 4.2,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 7,
    actorId: 10,
    parentId: 3,
    mass: MoonMass * 0.24,
    radius: MoonRadius * 0.27,
    axialTilt: 7.7,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 8,
    actorId: 11,
    parentId: 3,
    mass: MoonMass * 0.22,
    radius: MoonRadius * 0.21,
    axialTilt: 15.9,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 9,
    actorId: 12,
    parentId: 4,
    mass: MoonMass * 0.65,
    radius: MoonRadius * 0.7,
    axialTilt: 3.1,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 10,
    actorId: 13,
    parentId: 4,
    mass: MoonMass * 0.42,
    radius: MoonRadius * 0.5,
    axialTilt: 17.2,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 11,
    actorId: 14,
    parentId: 4,
    mass: MoonMass * 0.15,
    radius: MoonRadius * 0.2,
    axialTilt: 9.6,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 12,
    actorId: 15,
    parentId: 5,
    mass: MoonMass * 0.85,
    radius: MoonRadius * 0.8,
    axialTilt: 7.1,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 13,
    actorId: 16,
    parentId: 5,
    mass: MoonMass * 0.64,
    radius: MoonRadius * 0.6,
    axialTilt: 15.5,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 14,
    actorId: 17,
    parentId: 5,
    mass: MoonMass * 1.32,
    radius: MoonRadius * 1.3,
    axialTilt: 19.2,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 15,
    actorId: 18,
    parentId: 5,
    mass: MoonMass * 0.95,
    radius: MoonRadius * 0.98,
    axialTilt: 5.7,
    orbitalPeriod: 2.246975358369535e2,
    rotationPeriod: 5832.443616,
    temperature: 0
  },
  {
    id: 53,
    actorId: 3,
    parentId: null,
    mass: SolarMass * 1.1 + SolarMass * 0.7,
    radius: 1,
    axialTilt: 0,
    orbitalPeriod: 1,
    rotationPeriod: 1,
    temperature: 0
  }
]

const YavinPhysicalObjects: IPhysicalObject[] = [
  {
    id: 61,
    actorId: 88,
    parentId: null,
    mass: SolarMass * 0.85,
    radius: SolarRadius * 0.89,
    axialTilt: 0,
    orbitalPeriod: 0,
    rotationPeriod: 10,
    temperature: 3955
  },
  {
    id: 62,
    actorId: 89,
    parentId: 61,
    mass: JupiterMass * 1.6,
    radius: 195500,
    axialTilt: 15.5,
    orbitalPeriod: 10,
    rotationPeriod: 15,
    temperature: 0
  },
  {
    id: 63,
    actorId: 91,
    parentId: 62,
    mass: 4.868e24,
    radius: 10200,
    axialTilt: 25.2,
    orbitalPeriod: 10,
    rotationPeriod: 24.6,
    temperature: 0
  }
]

export const PhysicalObjects: IPhysicalObject[] = [...TatooPhysicalObjects, ...YavinPhysicalObjects]
