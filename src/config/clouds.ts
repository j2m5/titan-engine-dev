import type { SceneCloudPreset, SurfaceCloudMap } from '@/core/clouds/SceneCloudConfig'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'

function farMap(resourceId: number): SurfaceCloudMap {
  return {
    pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId } },
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    color: { kind: 'constant', srgb: [1, 1, 1] }
  }
}

export const sceneCloudPresets: ReadonlyMap<number, SceneCloudPreset> = new Map([
  [7, { volume: createEarthCloudProfile(), far: farMap(26), qualityProfile: 'terrestrial' }],
  [10, { volume: createJupiterCloudProfile(), far: null, qualityProfile: 'giant' }],
  [13, { volume: null, far: farMap(37), qualityProfile: 'giant' }],
  [88, { volume: null, far: farMap(113), qualityProfile: 'terrestrial' }]
])
