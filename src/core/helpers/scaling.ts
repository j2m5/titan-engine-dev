import { AU, SpaceScale } from '@/core/constants'

export function fromAstronomicalUnits(value: number): number {
  return value * AU * SpaceScale
}

export function fromKilometers(value: number): number {
  return value / SpaceScale
}

export function toThreeJSUnits(value: number): number {
  return value * SpaceScale
}

export function toAstronomicalUnits(value: number): number {
  return value / AU / SpaceScale
}
