import type { CloudColor, CloudConfigIssue, CloudPattern, EnabledCloudConfig } from './CloudConfig'

export type CloudQuality = 'low' | 'medium' | 'high'
export type CloudQualityProfile = 'terrestrial' | 'giant'
export type SurfaceCloudMap = {
  pattern: Extract<CloudPattern, { kind: 'mask' }>
  mapping: EnabledCloudConfig['mapping']
  color: CloudColor
}
export type SceneCloudDescriptor = {
  state: 'unconfigured' | 'off' | 'configured' | 'invalid'
  volume: EnabledCloudConfig | null
  far: SurfaceCloudMap | null
  qualityProfile: CloudQualityProfile
  issues: readonly CloudConfigIssue[]
}
export type SceneCloudPreset = {
  volume: EnabledCloudConfig | null
  far: SurfaceCloudMap | null
  qualityProfile: CloudQualityProfile
}
