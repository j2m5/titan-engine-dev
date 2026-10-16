export type SceneCloudProbeName = 'maps' | 'depth' | 'lighting' | 'receivers' | 'pipeline' | 'lifecycle' | 'flight'
export interface SceneCloudProbeReport {
  name: string
  checks: number
  maxError: number
  resourcesReleased: boolean
  cases: string[]
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
