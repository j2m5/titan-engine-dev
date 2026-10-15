import { sceneCloudPresets } from '@/config/clouds'
import type { EnabledCloudConfig } from './CloudConfig'
import type { SceneCloudDescriptor, SurfaceCloudMap } from './SceneCloudConfig'
import { resolveCloudConfig, resolveSurfaceCloudMap } from './validateCloudConfig'

function surfaceFromVolume(config: EnabledCloudConfig): SurfaceCloudMap | null {
  const layer = config.layers[0]
  return config.farAppearance === 'surface-map' && config.layers.length === 1 && layer.pattern.kind === 'mask'
    ? { pattern: layer.pattern, mapping: config.mapping, color: layer.color }
    : null
}

export function resolveSceneClouds(
  actorId: number,
  value: unknown,
  availableResourceIds: ReadonlySet<number>
): SceneCloudDescriptor {
  const preset = sceneCloudPresets.get(actorId)
  const qualityProfile = preset?.qualityProfile ?? 'terrestrial'
  const empty = { volume: null, far: null, qualityProfile, issues: [] } as const
  const explicit = resolveCloudConfig(value, availableResourceIds)
  if (explicit.state === 'off') return { ...empty, state: 'off' }
  if (explicit.state === 'configured') {
    return { ...empty, state: 'configured', volume: explicit.config, far: surfaceFromVolume(explicit.config) }
  }
  if (explicit.state === 'unconfigured' && !preset) return { ...empty, state: 'unconfigured' }
  const checkedFar = preset?.far ? resolveSurfaceCloudMap(preset.far, availableResourceIds) : { far: null, issues: [] }
  if (explicit.state === 'invalid') return { ...empty, state: 'invalid', far: checkedFar.far, issues: explicit.issues }
  const volume = preset?.volume ? resolveCloudConfig(preset.volume, availableResourceIds) : null
  const issues = [...checkedFar.issues, ...(volume?.state === 'invalid' ? volume.issues : [])]
  return {
    ...empty,
    state: issues.length ? 'invalid' : 'configured',
    volume: volume?.state === 'configured' ? volume.config : null,
    far: checkedFar.far,
    issues
  }
}
