import { synthBaseField, synthValueNoise3 } from './synthNoise'

export const TITAN_CLOUD_SEED = 0x54697461
export const TITAN_CLOUD_WIDTH = 2048
export const TITAN_CLOUD_PATH = 'planets/titan/titan_methane_coverage.png'

type Direction = readonly [number, number, number]
const radians = (degrees: number) => (degrees * Math.PI) / 180
const dot = (a: Direction, b: Direction) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const smooth = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/**
 * Synthetic weather, not an observation mosaic or a reconstruction of one date.
 * Cassini references for the latitude bias and discrete/streaky morphology:
 * https://science.nasa.gov/photojournal/titans-moving-mid-latitude-clouds/
 * https://www.jpl.nasa.gov/images/pia12811-titans-northern-polar-clouds/
 * https://www.usgs.gov/publications/characterization-clouds-titans-tropical-atmosphere
 * Longitudes, footprints and amplitudes below are authored scene parameters.
 * No third-party image pixels or trained segmentation models are used.
 */
const systems = [
  // Latitude, engine longitude (u * 360), major/minor angular radii, tilt, strength.
  [-53, 0, 13, 3.8, 12, 1],
  [-48, 52, 11, 3.6, -7, 0.95],
  [-59, 101, 9, 3.3, 23, 0.85],
  [-46, 150, 16, 3, 9, 1],
  [-55, 201, 12, 4, 28, 0.95],
  [-49, 252, 15, 3.5, -12, 1],
  [-61, 312, 11, 4, -28, 0.9],
  [-72, 238, 9, 3.5, 22, 0.85],
  [65, 42, 10, 2.8, 17, 0.9],
  [72, 120, 12, 3, -12, 0.95],
  [61, 206, 8, 2.5, 12, 0.85],
  [76, 300, 7, 2.5, 0, 0.8],
  [-14, 132, 5, 1.8, 40, 0.85]
].map(([latitude, longitude, major, minor, tilt, strength]) => {
  const lat = radians(latitude),
    lon = radians(longitude),
    angle = radians(tilt)
  const center: Direction = [-Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat)]
  const east: Direction = [Math.sin(lon), 0, Math.cos(lon)]
  const north: Direction = [Math.cos(lon) * Math.sin(lat), Math.cos(lat), -Math.sin(lon) * Math.sin(lat)]
  return {
    center,
    east,
    north,
    major: Math.sin(radians(major)),
    minor: Math.sin(radians(minor)),
    cosTilt: Math.cos(angle),
    sinTilt: Math.sin(angle),
    strength
  }
})

/** Sample a unit sphere, so the field is continuous through the UV seam and poles. */
export function sampleTitanCloudCoverage(direction: Direction): number {
  const [x, y, z] = direction
  let envelope = 0
  // Smooth elliptical systems are deformed in 3D, never in stretched latitude UVs.
  for (const system of systems) {
    if (dot(direction, system.center) < 0.85) continue
    const east = dot(direction, system.east),
      north = dot(direction, system.north)
    const along = (east * system.cosTilt + north * system.sinTilt) / system.major
    const across = (-east * system.sinTilt + north * system.cosTilt) / system.minor
    const radius = Math.hypot(along, across)
    if (radius > 1.35) continue
    const distortion = 0.22 * synthValueNoise3(x * 24, y * 24, z * 24, TITAN_CLOUD_SEED)
    envelope = Math.max(envelope, system.strength * (1 - smooth(0.35, 1.1, radius + distortion)))
  }
  if (envelope === 0) return 0
  const billows = synthBaseField(x, y, z, TITAN_CLOUD_SEED ^ 0x43484f34, 4, 90)
  const breakup = smooth(-0.4, 0.22, billows)
  // Dense cores survive mip reduction; irregular edges and gaps remain genuinely empty.
  return smooth(0.06, 0.88, envelope * (0.42 + 0.58 * breakup))
}

/** One linear byte per texel. Row zero is north; samples lie at texel centres. */
export function createTitanCloudCoverage(width = TITAN_CLOUD_WIDTH) {
  if (!Number.isInteger(width) || width < 64 || width > 4096 || width % 2 !== 0)
    throw new Error('Titan coverage width must be an even integer from 64 to 4096')
  const height = width / 2
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const theta = ((y + 0.5) * Math.PI) / height
    const sinTheta = Math.sin(theta),
      cosTheta = Math.cos(theta)
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) * 2 * Math.PI) / width
      data[y * width + x] = Math.round(
        255 * sampleTitanCloudCoverage([-Math.cos(phi) * sinTheta, cosTheta, Math.sin(phi) * sinTheta])
      )
    }
  }
  return { width, height, data }
}
