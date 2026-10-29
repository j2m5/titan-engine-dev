import type { SceneCloudPreset, SurfaceCloudMap } from '@/core/clouds/SceneCloudConfig'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { createVenusCloudProfile } from '@/core/clouds/profiles/venusCloudProfile'
import { createSaturnCloudProfile } from '@/core/clouds/profiles/saturnCloudProfile'
import { createUranusCloudProfile } from '@/core/clouds/profiles/uranusCloudProfile'
import { createNeptuneCloudProfile } from '@/core/clouds/profiles/neptuneCloudProfile'
import { createTitanCloudProfile, titanCloudMap } from '@/core/clouds/profiles/titanCloudProfile'
import { createExtrasolarGiantCloudPresets } from '@/core/clouds/profiles/extrasolarGiantCloudProfiles'
import { createKorribanCloudProfile } from '@/core/clouds/profiles/korribanCloudProfile'

function farMap(resourceId: number): SurfaceCloudMap {
  return {
    pattern: { kind: 'mask', encoding: 'rgb-cloud-map', map: { resourceId } },
    mapping: { frame: 'planet-fixed', projection: 'equirectangular', longitudeOffsetRadians: 0 },
    color: { kind: 'constant', srgb: [1, 1, 1] }
  }
}

export const sceneCloudPresets: ReadonlyMap<number, SceneCloudPreset> = new Map([
  [6, { volume: createVenusCloudProfile(), far: null, qualityProfile: 'terrestrial' }],
  [7, { volume: createEarthCloudProfile(), far: farMap(26), qualityProfile: 'terrestrial' }],
  [10, { volume: createJupiterCloudProfile(), far: null, qualityProfile: 'giant' }],
  [11, { volume: createSaturnCloudProfile(), far: null, qualityProfile: 'giant' }],
  [12, { volume: createUranusCloudProfile(), far: null, qualityProfile: 'giant' }],
  [13, { volume: createNeptuneCloudProfile(), far: farMap(37), qualityProfile: 'giant' }],
  [29, { volume: createTitanCloudProfile(), far: structuredClone(titanCloudMap), qualityProfile: 'terrestrial' }],
  ...createExtrasolarGiantCloudPresets(),
  [88, { volume: createKorribanCloudProfile(), far: farMap(113), qualityProfile: 'terrestrial' }]
])
