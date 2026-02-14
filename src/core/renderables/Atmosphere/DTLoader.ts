import { Data3DTexture, DataTexture, FloatType, LinearFilter } from 'three'
import { threeJS } from '@/core/graphic/ThreeJS'
import { notificationStore } from '@/ui/mobx/NotificationStore'
import { Storage } from '@/core/framework/file/Storage'

const TRANSMITTANCE_TEXTURE_WIDTH = 256
const TRANSMITTANCE_TEXTURE_HEIGHT = 64
const SCATTERING_TEXTURE_WIDTH = 256
const SCATTERING_TEXTURE_HEIGHT = 128
const SCATTERING_TEXTURE_DEPTH = 32
const IRRADIANCE_TEXTURE_WIDTH = 64
const IRRADIANCE_TEXTURE_HEIGHT = 16

class DTLoader {
  public files: string[]
  public textures: Map<string, DataTexture | Data3DTexture>

  public constructor() {
    this.files = [
      Storage.url('data/scattering.dat'),
      Storage.url('data/transmittance.dat'),
      Storage.url('data/irradiance.dat')
    ]
    this.textures = new Map()
  }

  public async load(): Promise<void> {
    try {
      const [scatteringData, transmittanceData, irradianceData] = await Promise.all(
        this.files.map((file) =>
          fetch(file)
            .then((res) => {
              if (res.ok) {
                return res.arrayBuffer()
              } else {
                throw new Error(`Failed to load ${file}: ${res.status} ${res.statusText}`)
              }
            })
            .then((buffer) => new Float32Array(buffer))
        )
      )

      const scatteringTexture = new Data3DTexture(
        scatteringData,
        SCATTERING_TEXTURE_WIDTH,
        SCATTERING_TEXTURE_HEIGHT,
        SCATTERING_TEXTURE_DEPTH
      )
      scatteringTexture.magFilter = scatteringTexture.minFilter = LinearFilter
      scatteringTexture.internalFormat = 'RGBA16F'
      scatteringTexture.type = FloatType
      scatteringTexture.needsUpdate = true

      const transmittanceTexture = new DataTexture(
        transmittanceData,
        TRANSMITTANCE_TEXTURE_WIDTH,
        TRANSMITTANCE_TEXTURE_HEIGHT
      )
      transmittanceTexture.magFilter = transmittanceTexture.minFilter = LinearFilter
      transmittanceTexture.internalFormat = threeJS.renderer.extensions.has('OES_texture_float_linear')
        ? 'RGBA32F'
        : 'RGBA16F'
      transmittanceTexture.type = FloatType
      transmittanceTexture.needsUpdate = true

      const irradianceTexture = new DataTexture(irradianceData, IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT)
      irradianceTexture.magFilter = irradianceTexture.minFilter = LinearFilter
      irradianceTexture.internalFormat = 'RGBA16F'
      irradianceTexture.type = FloatType
      irradianceTexture.needsUpdate = true

      console.log('scattering:', scatteringData.length, 'expected:', 256 * 128 * 32 * 4)
      console.log('transmittance:', transmittanceData.length, 'expected:', 256 * 64 * 4)
      console.log('irradiance:', irradianceData.length, 'expected:', 64 * 16 * 4)

      this.textures.set('scattering', scatteringTexture)
      this.textures.set('transmittance', transmittanceTexture)
      this.textures.set('irradiance', irradianceTexture)
    } catch (e) {
      notificationStore.dispatch({ type: 'error', message: String(e) })
    }
  }
}

export const dtLoader: DTLoader = new DTLoader()
