import { IRotationObject } from '@/core/models/types.ts'
import { SolarSystemRotationObjects } from '@storage/database/actors/MilkyWay/SolarSystem/RotationObjects'

const TOI519RotationObjects: IRotationObject[] = []

const SolarRotationObjects: IRotationObject[] = [...SolarSystemRotationObjects]

export const RotationObjects: IRotationObject[] = [...TOI519RotationObjects, ...SolarRotationObjects]
