import { Color, DataTexture, DataUtils, FloatType, HalfFloatType, PerspectiveCamera, RedFormat, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'
import { DepthVolumeResolutionRenderer } from '@/core/graphic/passes/DepthVolumeResolutionRenderer'
import { drawDepthVolumes } from '@/core/graphic/passes/DepthVolumePass'

function read(renderer: WebGLRenderer, target: WebGLRenderTarget): Float32Array {
  const bytes = new Uint16Array(target.width * target.height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, bytes)
  if (renderer.getContext().getError()) throw new Error('Temporal WebGL error')
  const pixels = Float32Array.from(bytes, value => DataUtils.fromHalfFloat(value))
  if (pixels.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid temporal HDR')
  return pixels
}

function error(a: Float32Array, b: Float32Array): number {
  let delta = 0, signal = 0
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) { delta += (a[i] - b[i]) ** 2; signal += b[i] ** 2 }
  return Math.sqrt(delta / Math.max(signal, 1e-12))
}

export function checkNebulaTemporal(baked = true): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.autoClear = false
  const size = new Vector2(64, 56), camera = new PerspectiveCamera(48, size.x / size.y, 0.01, 100)
  camera.position.set(0.1, 0.04, 2.4)
  camera.updateMatrixWorld()
  renderer.setSize(size.x, size.y)
  const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, depthBuffer: false })
  const depths = new Float32Array(size.x * size.y).fill(1)
  const depth = new DataTexture(depths, size.x, size.y, RedFormat, FloatType)
  depth.needsUpdate = true
  const params = mergeNebulaParams({
    seed: 728, density: 3, gas: { absorption: 0.5 }, dust: { strength: 0.9, frequency: 2.5 },
    noise: { octaves: 3, frequency: 4, contrast: 2, warpStrength: 0.2, worleyStrength: 0 },
    palette: { stops: [0, 0.3, 0.7, 1].map(t => ({ t, color: new Color(0.6, 1.4, 2) })), secondary: new Color(0.6, 1.4, 2), emissiveIntensity: 1.8 },
    lighting: { scatterStrength: 0 }, quality: { bake3DTexture: baked, maxSteps: 8, resolutionScale: 0.5, temporalBlend: 0.85 }
  })
  const volume = new NebulaVolume(params), baker = new NebulaDensityBaker(renderer, 64)
  volume.updateMatrixWorld()
  if (baked) { baker.bake(params); volume.material.setBakedDensityTexture(baker.texture) }
  const scaled = new DepthVolumeResolutionRenderer(), fresh = new DepthVolumeResolutionRenderer()
  let capture: Float32Array | null = null, resolved: Float32Array | null = null
  const draw = renderer.render.bind(renderer)
  renderer.render = (object, view) => {
    draw(object, view)
    const output = renderer.getRenderTarget()
    if (output && output !== target) {
      if (object === volume) capture = read(renderer, output)
      else resolved = read(renderer, output)
    }
  }
  const render = (helper = scaled, blend = 0.85, steps = 8, volumes = [volume]) => {
    capture = resolved = null
    params.quality.temporalBlend = blend
    volume.material.uniforms.uMaxSteps.value = steps
    camera.updateMatrixWorld()
    renderer.setRenderTarget(target)
    renderer.setClearColor(0, 0)
    renderer.clear()
    drawDepthVolumes(renderer, target, camera, volumes, depth, size, helper)
    return read(renderer, target)
  }
  try {
    const reference = render(fresh, 0, 128)
    const first = render()
    const second = render()
    if (!capture || !resolved) throw new Error('Temporal resolve not drawn')
    const historyContribution = error(resolved, capture)
    if (historyContribution < 0.0001) throw new Error(`No temporal contribution: ${historyContribution}`)
    let converged = second
    for (let i = 2; i < 16; i++) converged = render()
    const initialError = error(first, reference), convergedError = error(converged, reference)
    if (convergedError >= initialError * 0.85) throw new Error(`Temporal filtering did not improve: ${JSON.stringify({ initialError, convergedError, historyContribution })}`)
    const result: Record<string, number> = { initialError, convergedError, historyContribution }
    let movingError = 0, rawMovingError = 0
    for (let i = 0; i < 12; i++) {
      camera.position.x += 0.01
      const accurate = render(fresh, 0, 128)
      rawMovingError += error(render(fresh, 0, 8), accurate)
      movingError += error(render(), accurate)
    }
    result.movingError = movingError / 12
    result.rawMovingError = rawMovingError / 12
    if (movingError >= rawMovingError * 0.85) throw new Error(`Moving history did not improve accuracy: ${JSON.stringify(result)}`)

    camera.position.x += 0.7
    const cut = render(), cutFresh = render(fresh, 0)
    result.cutError = error(cut, cutFresh)
    if (result.cutError !== 0) throw new Error(`Camera cut retained history: ${result.cutError}`)

    // Covering and revealing the whole cloud must use current samples exactly,
    // including the formerly occluded pixels; no color can survive behind depth.
    depths.fill(Math.log2(1.1) / Math.log2(camera.far + 1))
    depth.needsUpdate = true
    const occluded = render()
    if (occluded.some(value => value !== 0)) throw new Error('History leaked through foreground depth')
    depths.fill(1)
    depth.needsUpdate = true
    render()
    if (!capture || !resolved || error(resolved, capture) !== 0) throw new Error('Reveal reused occluded history')

    // Partially occluded rays contain visible fog in front of the surface. They
    // must keep the fixed phase, while the surrounding sky may use history.
    const middleDepth = Math.log2(1 + 2.4) / Math.log2(camera.far + 1)
    for (let y = 0; y < size.y; y++) for (let x = 0; x < size.x / 2; x++) depths[y * size.x + x] = middleDepth
    depth.needsUpdate = true
    render()
    const partial = render(), partialFresh = render(fresh, 0)
    let partialError = 0
    for (let y = 0; y < size.y; y++) for (let x = 0; x < size.x / 2 - 2; x++) for (let c = 0; c < 4; c++) {
      const i = (y * size.x + x) * 4 + c
      partialError = Math.max(partialError, Math.abs(partial[i] - partialFresh[i]))
    }
    result.partialError = partialError
    if (partialError > 0.001) throw new Error(`Occluded rays animated or retained history: ${partialError}`)
    depths.fill(1)
    depth.needsUpdate = true

    // A new overlapping volume starts with its own history. Transparent emission
    // must survive all stages without alpha division or clamping of HDR radiance.
    const emissionParams = mergeNebulaParams({
      ...params, gas: { absorption: 0 }, dust: { strength: 0 },
      palette: { stops: [0, 0.3, 0.7, 1].map(t => ({ t, color: new Color(4, 0.1, 0.2) })), secondary: new Color(4, 0.1, 0.2), emissiveIntensity: 4 },
      quality: { ...params.quality, temporalBlend: 0.85 }
    })
    const emission = new NebulaVolume(emissionParams)
    if (baked) emission.material.setBakedDensityTexture(baker.texture)
    emission.updateMatrixWorld()
    const layered = new DepthVolumeResolutionRenderer(), separateA = new DepthVolumeResolutionRenderer(), separateB = new DepthVolumeResolutionRenderer()
    try {
      let accumulated = new Float32Array(size.x * size.y * 4)
      result.overlapError = 0
      for (let i = 0; i < 6; i++) {
        const a = render(separateA), b = render(separateB, 0.85, 8, [emission])
        const composite = render(layered, 0.85, 8, [volume, emission])
        const expected = Float32Array.from(a, (value, channel) => value + b[channel])
        result.overlapError = Math.max(result.overlapError, error(composite, expected))
        accumulated = b
      }
      if (result.overlapError > 0.003) throw new Error('Volume histories mixed or emission composited incorrectly')
      if (accumulated.some((value, i) => i % 4 === 3 && value !== 0) || Math.max(...accumulated) < 1) throw new Error('Alpha-zero temporal emission lost')
    } finally {
      layered.dispose(); separateA.dispose(); separateB.dispose()
      emission.dispose(); emission.geometry.dispose(); emission.material.dispose()
    }

    size.set(65, 55)
    target.setSize(size.x, size.y)
    renderer.setSize(size.x, size.y)
    camera.aspect = size.x / size.y
    camera.updateProjectionMatrix()
    // Normalized sky sampling remains valid with the old all-sky depth texture.
    const resized = render(), resizedFresh = render(fresh, 0)
    result.resizeError = error(resized, resizedFresh)
    if (result.resizeError !== 0) throw new Error('Resize retained incompatible history')
    return result
  } finally {
    renderer.render = draw
    renderer.setRenderTarget(null)
    scaled.dispose(); fresh.dispose(); baker.dispose(); depth.dispose(); target.dispose()
    volume.geometry.dispose(); volume.material.dispose(); volume.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
