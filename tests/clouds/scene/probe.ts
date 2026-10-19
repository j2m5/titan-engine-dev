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
      'equal-hdr-endpoints',
      'terrain-water-main-composition',
      'near-failure-restoration',
      'foreground-slot-insertion',
      'async-tiled-bitmap-equivalence'
    ]
  },
  receivers: {
    load: () => import('./receivers.gpu'),
    requiredCases: [
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
      'state-restoration'
    ]
  },
  lighting: {
    load: () => import('./lighting.gpu'),
    requiredCases: [
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
      'eclipse-direct',
      'reset-recreation',
      'single-public-update',
      'shader-failure-restoration',
      'borrowed-ownership',
      'unsupported-projection',
      'foreground-slot-order'
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

export async function runSceneCloudProbe(name: SceneCloudProbeName): Promise<SceneCloudProbeReport> {
  const probe = sceneCloudProbeRegistry[name]
  if (!probe) throw new Error(`Unimplemented or unknown scene cloud probe: ${name}`)
  const report = await (await probe.load()).run()
  const missing = probe.requiredCases.filter((id) => !report.cases.includes(id))
  if (
    report.name !== name ||
    missing.length ||
    report.checks < probe.requiredCases.length ||
    !Number.isFinite(report.maxError) ||
    !report.resourcesReleased
  )
    throw new Error(`Incomplete scene cloud probe ${name}: ${JSON.stringify({ report, missing })}`)
  return report
}
