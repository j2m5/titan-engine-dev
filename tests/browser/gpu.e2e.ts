import { test, runProbe } from './probe'

const probes: { title: string; path: string; name: string; args?: unknown[] }[] = [
  { title: 'water ocean surface', path: 'water/oceanView', name: 'checkOceanView' },
  { title: 'nebula seed', path: 'nebula/rendering', name: 'checkNebulaSeed' },
  { title: 'nebula world precision', path: 'nebula/rendering', name: 'checkNebulaWorldPrecision' },
  { title: 'nebula bake state', path: 'nebula/rendering', name: 'checkNebulaBakeState' },
  { title: 'nebula baked program', path: 'nebula/bakedProgram', name: 'checkNebulaBakedProgram' },
  { title: 'nebula absorption', path: 'nebula/rendering', name: 'checkNebulaAbsorption' },
  { title: 'nebula gas dust optics', path: 'nebula/gasDust', name: 'checkNebulaGasDustOptics' },
  { title: 'nebula gas dust fields', path: 'nebula/gasDust', name: 'checkNebulaGasDustFields' },
  { title: 'nebula directed structure', path: 'nebula/directedStructure', name: 'checkNebulaDirectedStructure' },
  { title: 'nebula light transport', path: 'nebula/lightTransport', name: 'checkNebulaLightTransport' },
  { title: 'nebula lighting images', path: 'nebula/lightTransport', name: 'checkNebulaLightingImages' },
  { title: 'nebula resolution', path: 'nebula/resolution', name: 'checkNebulaResolution' },
  { title: 'nebula reconstruction', path: 'nebula/reconstruction', name: 'checkNebulaReconstruction' },
  { title: 'nebula resolution fields', path: 'nebula/resolution', name: 'checkNebulaResolutionFields' },
  { title: 'nebula temporal baked', path: 'nebula/temporal', name: 'checkNebulaTemporal', args: [true] },
  { title: 'nebula temporal procedural', path: 'nebula/temporal', name: 'checkNebulaTemporal', args: [false] },
  { title: 'nebula LOD composition', path: 'nebula/rendering', name: 'checkNebulaLodComposition' },
  { title: 'nebula emission LOD', path: 'nebula/rendering', name: 'checkNebulaLodComposition', args: [{ gas: { absorption: 0 }, dust: { strength: 0 } }] },
  { title: 'nebula dust LOD', path: 'nebula/rendering', name: 'checkNebulaLodComposition', args: [{ density: 0 }] },
  { title: 'nebula lighting LOD', path: 'nebula/lightTransport', name: 'checkNebulaLightingLod' },
  { title: 'nebula diagonal bake', path: 'nebula/rendering', name: 'checkNebulaDiagonalBake' },
  { title: 'nebula incremental baking', path: 'nebula/rendering', name: 'checkNebulaIncrementalBaking' },
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
