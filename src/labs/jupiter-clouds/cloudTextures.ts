import { CloudShape, CloudShapeDetail } from '@takram/three-clouds'
import { Data3DTexture, DataTexture, NearestFilter, RedFormat, RepeatWrapping, RGBAFormat } from 'three'

/** Local procedural assets: no CDN, storage bucket, or Earth weather-map seams. */
export function createCloudTextures() {
  const weather = new DataTexture(new Uint8Array([140, 0, 0, 0]), 1, 1, RGBAFormat)
  weather.needsUpdate = true
  const shape = new CloudShape()
  const detail = new CloudShapeDetail()

  // Deterministic white-noise jitter for the experiment, not upstream's NVIDIA STBN asset.
  // The renderer accepts arbitrary noise texture dimensions via textureSize().
  const noiseBytes = new Uint8Array(64 * 64 * 64)
  let seed = 0x4a757069
  for (let i = 0; i < noiseBytes.length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    noiseBytes[i] = seed & 255
  }
  const noise = new Data3DTexture(noiseBytes, 64, 64, 64)
  noise.format = RedFormat
  noise.minFilter = noise.magFilter = NearestFilter
  noise.wrapS = noise.wrapT = noise.wrapR = RepeatWrapping
  noise.needsUpdate = true

  return {
    weather,
    shape,
    detail,
    noise,
    dispose(): void {
      weather.dispose()
      shape.dispose()
      detail.dispose()
      noise.dispose()
    }
  }
}
