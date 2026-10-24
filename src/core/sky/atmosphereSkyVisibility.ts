import { MathUtils, Uniform } from 'three'
import { eclipseLightCpu } from '@/core/eclipse/eclipseMath'
import type { AtmosphereFrameSnapshot } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import { EARTH_SOLAR, type DensityProfileLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'

/** Shared by the background, its extracted layer, and both lens paths. */
export const skyAtmosphereUniforms = {
  uSkyAtmosphereVisibility: new Uniform(1)
}

const luminance = (rgb: readonly number[]): number => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
const EARTH_SOLAR_LUMINANCE = luminance(EARTH_SOLAR)
const COLUMN_STEPS = 32

function density(layer: DensityProfileLayer, altitudeKm: number): number {
  return MathUtils.clamp(
    layer.expTerm * Math.exp(layer.expScale * altitudeKm) + layer.linearTerm * altitudeKm + layer.constantTerm,
    0,
    1
  )
}

/** Radial column above the observer, in km, with the same layer boundaries and density clamp as Bruneton. */
function densityColumn(profile: readonly DensityProfileLayer[], altitudeKm: number, topKm: number): number {
  let column = 0
  for (let layerIndex = 0; layerIndex < 2; layerIndex++) {
    const start = Math.max(altitudeKm, layerIndex === 0 ? 0 : profile[0].width)
    const end = Math.min(topKm, layerIndex === 0 ? profile[0].width : topKm)
    if (end <= start) continue
    const layer = profile[layerIndex]
    let previousHeight = start
    let previousDensity = density(layer, start)
    // Quadratic spacing resolves the dense bottom of short exponential profiles
    // without increasing work for very tall giant-planet shells.
    for (let step = 1; step <= COLUMN_STEPS; step++) {
      const height = start + (end - start) * (step / COLUMN_STEPS) ** 2
      const nextDensity = density(layer, height)
      column += (height - previousHeight) * (previousDensity + nextDensity) * 0.5
      previousHeight = height
      previousDensity = nextDensity
    }
  }
  return column
}

/**
 * Display compensation for the deliberately enhanced space background. This is
 * not extra physical extinction: AtmosphereEffect still applies its LUT
 * transmittance to every object. Only background stars/galaxy lose contrast in
 * sunlit, dense air; the Sun and scene geometry retain their own brightness.
 *
 * The optical column sets the altitude range per atmosphere, rather than an
 * Earth-specific height cutoff. For Earth the background is hidden in the
 * lowest ~10 km and smoothly returns through the next few scale heights.
 */
export function atmosphereSkyVisibility(frame: AtmosphereFrameSnapshot): number {
  let visibility = 1
  for (const { entry, generation, centerKm, sunDirection } of frame.slots) {
    if (!entry.ready || entry.generation !== generation) continue
    const config = entry.config
    const radius = centerKm.length()
    if (radius <= 0 || radius >= config.topRadius) continue
    const sunCosine = -centerKm.dot(sunDirection) / radius
    // No extra suppression on the night side. Fade over the first ~4.6° of
    // solar elevation so crossing the terminator never switches the sky off.
    const daylight = MathUtils.smoothstep(sunCosine, 0, 0.08)
    if (daylight === 0) continue

    const altitude = Math.max(0, radius - config.bottomRadius)
    const top = config.topRadius - config.bottomRadius
    const rayleigh = densityColumn(config.rayleighDensity, altitude, top)
    const mie = densityColumn(config.mieDensity, altitude, top)
    const eclipse = entry.eclipse
    const light = eclipse?.count
      ? eclipseLightCpu(
          [-centerKm.x, -centerKm.y, -centerKm.z],
          eclipse.star.toArray(),
          eclipse.starRadius,
          eclipse.occluders.slice(0, eclipse.count).map((occluder, index) => ({
            center: [occluder.x, occluder.y, occluder.z],
            radius: occluder.w,
            umbra: {
              tint: [eclipse.umbra[index].x, eclipse.umbra[index].y, eclipse.umbra[index].z],
              glow: eclipse.umbra[index].w
            }
          }))
        )
      : [1, 1, 1]
    const litColumn = config.solarIrradiance.map(
      (irradiance, channel) =>
        (config.rayleighScattering[channel] * rayleigh + config.mieScattering[channel] * mie) *
        irradiance *
        light[channel]
    )
    const brightness = (luminance(litColumn) / EARTH_SOLAR_LUMINANCE) * ((config.exposure ?? 10) / 1.4)
    // A display calibration, not a change to the atmosphere's density:
    // optically thin columns remain neutral, dense illuminated columns hide
    // even HDR catalogue stars before bloom and tone mapping.
    const washout = MathUtils.smoothstep(brightness, 0.002, 0.03)
    visibility *= 1 - daylight * washout
  }
  return visibility
}
