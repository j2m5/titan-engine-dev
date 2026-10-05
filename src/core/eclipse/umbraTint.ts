import type { AtmosphereConfig, DensityProfileLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import type { Vec3 } from '@/core/eclipse/eclipseMath'

/** Шагов интеграла по касательной хорде. */
export const UMBRA_STEPS = 512

function layerDensity(layer: DensityProfileLayer, h: number): number {
  return Math.min(1, Math.max(0, layer.expTerm * Math.exp(layer.expScale * h) + layer.linearTerm * h + layer.constantTerm))
}

// Профиль Брунетона: слой 0 ниже своей ширины, выше — слой 1
function profileDensity(profile: [DensityProfileLayer, DensityProfileLayer], h: number): number {
  return h < profile[0].width ? layerDensity(profile[0], h) : layerDensity(profile[1], h)
}

/**
 * Цвет красной умбры: пропускание по касательной хорде через всю толщу атмосферы
 * (прицельный параметр — дно), нормированное по максимальному каналу.
 * τ = ∫(β_R·ρ_R + β_M,ext·ρ_M + β_A·ρ_A) ds, T = exp(−τ). Единицы — км.
 */
export function umbraTintFromAtmosphere(c: AtmosphereConfig): Vec3 {
  const bottom = c.bottomRadius
  const half = Math.sqrt(Math.max(c.topRadius * c.topRadius - bottom * bottom, 0))
  const ds = (2 * half) / UMBRA_STEPS
  const tau: Vec3 = [0, 0, 0]
  for (let k = 0; k < UMBRA_STEPS; k++) {
    const s = -half + (k + 0.5) * ds
    const h = Math.sqrt(bottom * bottom + s * s) - bottom
    const rR = profileDensity(c.rayleighDensity, h)
    const rM = profileDensity(c.mieDensity, h)
    const rA = profileDensity(c.absorptionDensity, h)
    for (const ch of [0, 1, 2] as const) {
      tau[ch] += (c.rayleighScattering[ch] * rR + c.mieExtinction[ch] * rM + c.absorptionExtinction[ch] * rA) * ds
    }
  }
  // Нормировка в лог-пространстве: max-канал ровно 1, без underflow при большой τ
  const tauMin = Math.min(tau[0], tau[1], tau[2])
  return [Math.exp(-(tau[0] - tauMin)), Math.exp(-(tau[1] - tauMin)), Math.exp(-(tau[2] - tauMin))]
}
