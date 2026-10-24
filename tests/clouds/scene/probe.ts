export type SceneCloudProbeName =
  | 'scheduling'
  | 'maps'
  | 'depth'
  | 'lighting'
  | 'readiness'
  | 'receivers'
  | 'pipeline'
  | 'lifecycle'
  | 'flight'
export interface SceneCloudProbeReport {
  name: string
  checks: number
  maxError: number
  resourcesReleased: boolean
  cases: string[]
  scope?: 'full' | 'peak'
  expectedShaderFailureWindows?: Array<{ start: number; end: number }>
}

export const sceneCloudProbeRegistry: Partial<
  Record<
    SceneCloudProbeName,
    {
      load: () => Promise<{ run(): Promise<SceneCloudProbeReport> }>
      requiredCases: readonly string[]
    }
  >
> = {
  flight: {
    load: () => import('./flight.gpu'),
    requiredCases: [
      'production-solar-boot',
      'earth-altitude-path',
      'jupiter-altitude-path',
      'frame-budget',
      'control-flight',
      'capture-no-simulation',
      'day-terminator-night',
      'body-rotation-follow-collision',
      'sphere-terrain-water',
      'quick-body-switch',
      'settings-toggle',
      'authored-neptune',
      'authored-korriban',
      'real-lens-scenario',
      'isolated-main-performance',
      'stable-scenario-exits',
      'original-peak-depth',
      'moving-limb-consecutive',
      'same-pose-far-near-reference'
    ]
  },
  lifecycle: {
    load: () => import('./lifecycle.gpu'),
    requiredCases: [
      'quality-and-off',
      'bad-instance-shader-retry',
      'nonselected-depth-context-latch',
      'unknown-near-context-latch',
      'menu-depth-context-recovery',
      'menu-near-context-recovery',
      'source-eviction-reload',
      'same-id-new-bitmap',
      'independent-far-color',
      'scenario-pending-cancellation',
      'resize-dpr-4k-return',
      'webgl-loss-restore',
      'borrowed-ownership',
      'stable-enter-leave'
    ]
  },
  scheduling: {
    load: async () => ({
      run: async () => {
        const report = await (await import('./pipeline.gpu')).run('scheduling')
        return { ...report, name: 'scheduling', cases: report.cases.filter((id) => id.startsWith('simulation-')) }
      }
    }),
    requiredCases: [
      'simulation-presentation-invariance',
      'simulation-normal-frame-progression',
      'simulation-pending-readiness-invariance',
      'simulation-screenshot-invariance',
      'simulation-mutation-negative-control'
    ]
  },
  pipeline: {
    load: () => import('./pipeline.gpu'),
    requiredCases: [
      'full-material-sampler-budget',
      'receiver-link-failure-recovery',
      'earth-main-composition',
      'jupiter-main-composition',
      'far-fallback',
      'responsive-large-source',
      'linear-hdr-mix',
      'single-frame-schedule',
      'bounded-near-material-sync',
      'equal-hdr-endpoints',
      'terrain-water-main-composition',
      'near-failure-restoration',
      'foreground-slot-insertion',
      'async-tiled-bitmap-equivalence',
      'gpu-warmup-and-activation-fade'
    ]
  },
  receivers: {
    load: () => import('./receivers.gpu'),
    requiredCases: [
      'far-only-13-37-jpeg',
      'far-only-88-113-png',
      'transparent-water-single-coverage',
      'oblique-datum',
      'body-rotation',
      'rgb-original-source',
      'sphere-terrain-uv-handoff',
      'shoreline',
      'sphere-shadow',
      'terrain-shadow',
      'water-shadow',
      'night-only',
      'ambient-only',
      'direct-only',
      'glint-only',
      'moving-shadow',
      'scalar-decoding',
      'scalar-color-same-different-missing',
      'borrowed-ownership'
    ]
  },
  readiness: {
    load: () => import('./readiness.gpu'),
    requiredCases: [
      'initial-default-shader-failure',
      'restore-retry',
      'deferred-previous-handler',
      'failed-program-retirement',
      'backend-retry',
      'noise-retry',
      'same-renderer-recovery',
      'state-restoration',
      'prepared-shader-failure-recovery'
    ]
  },
  lighting: {
    load: () => import('./lighting.gpu'),
    requiredCases: [
      'packed-current-output',
      'single-output-shadows',
      'low-shadow-ray-intervals',
      'medium-shadow-ray-intervals',
      'high-shadow-ray-intervals',
      'current-ray-intervals',
      'linear-density-profile',
      'stationary-weather-evolution',
      'empty-density-detail-sampling',
      'white-star',
      'colored-star',
      'zenith',
      'limb',
      'near-bottom',
      'datum-bottom-offset',
      'fixed-alpha-aerial',
      'negative-controls',
      'fresh-resolved',
      'noon',
      'terminator',
      'night',
      'alpha-depth-shadow-invariance',
      'temporal-opacity-independent-of-light',
      'temporal-fresh-pixel-accumulation',
      'cloud-hit-reprojection-precision',
      'eclipse-direct',
      'reset-recreation',
      'single-public-update',
      'shader-failure-restoration',
      'borrowed-ownership',
      'unsupported-projection',
      'foreground-slot-order',
      'scene-reference-white-limit',
      'scene-reference-physical-negative-control',
      'scene-reference-nonpositive-sky-strength',
      'scene-reference-optical-depth',
      'scene-reference-night-eclipse',
      'scene-reference-albedo-alpha',
      'scene-reference-owner-tint',
      'giant-physical-source',
      'scene-reference-march-invariants',
      'scene-reference-sun-shadow-partition',
      'scene-reference-sun-shadow-culling',
      'scene-reference-real-eclipse'
    ]
  },
  depth: {
    load: () => import('./depth.gpu'),
    requiredCases: [
      'above-inside-below-layer',
      'low-medium-jitter',
      'visible-water',
      'seabed-below-datum',
      'terrain-peak-above-8km',
      'dry-shore',
      'zero-absorption-shore-final-alpha',
      'tiny-positive-final-alpha-water',
      'zero-final-alpha-branch-fixture',
      'positive-coverage-shore',
      'water-waves-foam-variant',
      'foreground-opaque',
      'alpha-cut-solid',
      'alpha-cut-hole',
      'planet-horizon',
      'failure-restoration',
      'msaa',
      'no-msaa'
    ]
  },
  maps: {
    load: () => import('./sourceMaps.gpu'),
    requiredCases: [
      'bitmap-corners',
      'html-corners',
      'data-corners',
      'seam',
      'poles',
      'body-rotation',
      'bitmap-replacement',
      'decode-before-reduce',
      'borrowed-ownership'
    ]
  }
}

/** A focused closure reports only the cases it actually executes. */
export function getSceneCloudFlightScope(start?: string): { start: 'full' | 'peak'; requiredCases: readonly string[] } {
  if (start !== undefined && start !== 'peak') throw new Error('SCENE_CLOUD_FLIGHT_START only accepts peak')
  const requiredCases = sceneCloudProbeRegistry.flight!.requiredCases
  const completedEarthCases = new Set([
    'earth-altitude-path',
    'frame-budget',
    'control-flight',
    'capture-no-simulation',
    'day-terminator-night',
    'body-rotation-follow-collision',
    'sphere-terrain-water',
    'isolated-main-performance'
  ])
  return {
    start: start ?? 'full',
    requiredCases: start === 'peak' ? requiredCases.filter((id) => !completedEarthCases.has(id)) : requiredCases
  }
}

export async function runSceneCloudProbe(name: SceneCloudProbeName): Promise<SceneCloudProbeReport> {
  const probe = sceneCloudProbeRegistry[name]
  if (!probe) throw new Error(`Unimplemented or unknown scene cloud probe: ${name}`)
  const report = await (await probe.load()).run()
  const requiredCases =
    name === 'flight'
      ? getSceneCloudFlightScope(Reflect.get(window, '__sceneCloudFlightStart')).requiredCases
      : probe.requiredCases
  const missing = requiredCases.filter((id) => !report.cases.includes(id))
  if (
    report.name !== name ||
    missing.length ||
    report.checks < requiredCases.length ||
    !Number.isFinite(report.maxError) ||
    !report.resourcesReleased
  )
    throw new Error(`Incomplete scene cloud probe ${name}: ${JSON.stringify({ report, missing })}`)
  return report
}
