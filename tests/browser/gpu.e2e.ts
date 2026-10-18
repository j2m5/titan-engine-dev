import { test, runProbe } from './probe'

const probes: { title: string; path: string; name: string; args?: unknown[] }[] = [
  { title: 'atmosphere terminator', path: 'atmosphere/terminator', name: 'checkAtmosphereTerminator' },
  { title: 'black hole depth (0 samples)', path: 'blackHole/insideDepth', name: 'checkBlackHoleInsideDepth', args: [0] },
  { title: 'black hole depth (4 samples)', path: 'blackHole/insideDepth', name: 'checkBlackHoleInsideDepth', args: [4] },
  { title: 'star LOD photometry', path: 'star/lodPhotometry', name: 'checkStarLodPhotometry' },
  { title: 'star granulation filtering', path: 'star/granulationFiltering', name: 'checkStarGranulationFiltering' },
  { title: 'star granulation photometry', path: 'star/granulationPhotometry', name: 'checkStarGranulationPhotometry' },
  { title: 'star camera finalization', path: 'star/cameraFinalization', name: 'checkStarCameraFinalization' },
  { title: 'star prominences', path: 'star/prominences', name: 'checkStarProminences' },
  { title: 'stellar bloom', path: 'graphic/stellarBloom', name: 'checkStellarBloom' },
  { title: 'bitmap context restoration', path: 'textures/ImageBitmapLifecycle', name: 'checkImageBitmapLifecycle' }
]

for (const probe of probes) {
  test(probe.title, async ({ probePage }, testInfo) => {
    // Five full atmosphere LUT bakes take ~162s on local SwiftShader; leave CI CPU headroom.
    if (probe.name === 'checkAtmosphereTerminator') test.setTimeout(900_000)
    await runProbe(probePage, testInfo, `/tests/${probe.path}.gpu.ts`, probe.name, probe.args)
  })
}
