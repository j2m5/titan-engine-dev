import { DataTexture, NearestFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three'
import { NEBULA_BLUE_NOISE_BASE64, NEBULA_BLUE_NOISE_SIZE } from './blueNoiseData'

/** Material-owned texture: no asynchronous asset load or runtime noise generation. */
export function createNebulaBlueNoiseTexture(): DataTexture {
  const data = Uint8Array.from(atob(NEBULA_BLUE_NOISE_BASE64), value => value.charCodeAt(0))
  const texture = new DataTexture(data, NEBULA_BLUE_NOISE_SIZE, NEBULA_BLUE_NOISE_SIZE, RedFormat, UnsignedByteType)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}
