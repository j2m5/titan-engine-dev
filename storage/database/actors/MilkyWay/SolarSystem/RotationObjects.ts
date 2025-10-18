import { IRotationObject } from '@/core/models/types.ts'

const Common: IRotationObject[] = [
  {
    id: 1,
    actorId: 34,
    meridianAngle: 128.3213,
    ascendingNode: 359.9949,
    inclination: 23.4608,
    period: 15542.2123958837952
  },
  {
    id: 2,
    actorId: 38,
    meridianAngle: 358.93,
    ascendingNode: 169.528,
    inclination: 28.052,
    period: 10.65622222
  }
]
const Satellites: IRotationObject[] = []

export const SolarSystemRotationObjects: IRotationObject[] = [...Common, ...Satellites]
