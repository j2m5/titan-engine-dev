import { Colorable } from '@/core/models/types'

export function calculateScatterRGB(color: Colorable, strength: number): Colorable {
  return {
    r: Math.pow(400 / color.r, 4) * strength,
    g: Math.pow(400 / color.g, 4) * strength,
    b: Math.pow(400 / color.b, 4) * strength
  }
}
