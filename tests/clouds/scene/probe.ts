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
