import {
  Color, Data3DTexture, DataTexture, DataUtils, FloatType, HalfFloatType, PerspectiveCamera,
  RedFormat, RGBAFormat, RGFormat, Vector2, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'

/** Known HDR texels distinguish depth-aware reconstruction from an unnecessary march. */
export function checkNebulaReconstruction(): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.setSize(4, 4)
  renderer.autoClear = false
  const target = new WebGLRenderTarget(4, 4, { type: HalfFloatType, depthBuffer: false })
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.updateMatrixWorld()
  const logFar = Math.log2(101), foreground = Math.log2(1.25) / logFar
  const depths = new Float32Array(16)
  const depth = new DataTexture(depths, 4, 4, RedFormat, FloatType)
  const low = new DataTexture(new Float32Array([
    1, 2, 3, 0.5, 3, 4, 5, 0.5,
    50, 50, 50, 0.5, 90, 90, 90, 0.5
  ]), 2, 2, RGBAFormat, FloatType)
  low.needsUpdate = true
  const field = new Data3DTexture(Float32Array.from({ length: 16 }, (_, i) => i % 2 ? 0.7 : 0.4), 2, 2, 2)
  field.format = RGFormat
  field.type = FloatType
  field.needsUpdate = true
  const volume = new NebulaVolume(mergeNebulaParams({
    lighting: { scatterStrength: 0 }, quality: { maxSteps: 8 }
  }))
  volume.material.setBakedDensityTexture(field)
  volume.material.uniforms.uLodBlend.value = 1
  // The supplied low image already includes opacity; resolving must not apply it again.
  volume.material.uniforms.uOpacityScale.value = 0.4
  volume.updateMatrixWorld()
  camera.layers.mask = volume.layers.mask
  // Exactly representable background values avoid compounding half-float blend rounding.
  const background = new Color(0.125, 0.25, 0.5)
  const results: Record<string, number> = {}
  const render = (reconstruct: boolean): Float32Array => {
    depth.needsUpdate = true
    volume.bindSceneDepth(depth, new Vector2(4, 4), logFar)
    if (reconstruct) volume.bindLowResolution(low, new Vector2(2, 2))
    else volume.unbindLowResolution()
    renderer.setRenderTarget(target)
    renderer.setClearColor(background, 1)
    renderer.clear(true, false, false)
    renderer.render(volume, camera)
    const half = new Uint16Array(64)
    renderer.readRenderTargetPixels(target, 0, 0, 4, 4, half)
    if (renderer.getContext().getError()) throw new Error('Nebula reconstruction WebGL error')
    const pixels = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
    if (pixels.some(value => !Number.isFinite(value))) throw new Error('Nonfinite reconstructed HDR')
    return pixels
  }
  const check = (name: string, pixels: Float32Array, x: number, y: number, expected: ArrayLike<number>) => {
    let error = 0
    for (let c = 0; c < 4; c++) error = Math.max(error, Math.abs(pixels[(y * 4 + x) * 4 + c] - expected[c]))
    results[name] = error
    if (error > 0.003) throw new Error(`${name}: HDR component error ${error}; actual=${pixels.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)}; expected=${expected}`)
  }
  try {
    depths.fill(1)
    if (Math.abs(render(false)[20] - background.r) < 0.005) throw new Error('Raymarch witness is empty')
    // At output (1,1), bilinear weights are 9/16, 3/16, 3/16, 1/16.
    // The bottom two matching taps normalize to 3/4 and 1/4. Bright invalid
    // top taps must not leak across a silhouette or a finite depth discontinuity.
    for (const [name, matched, rejected] of [
      ['sky rejects foreground', 1, foreground],
      ['foreground rejects sky', foreground, 1],
      ['foreground rejects different depth', foreground, Math.log2(1.5) / logFar]
    ] as const) {
      depths.fill(rejected)
      depths[1 * 4 + 1] = depths[1 * 4 + 3] = matched
      check(name, render(true), 1, 1, [1.5625, 2.625, 3.75, 1])
    }
    depths.fill(foreground)
    depths[1 * 4 + 1] = 1
    check('sole matching tap retains HDR and alpha', render(true), 1, 1, [1.0625, 2.125, 3.25, 1])

    // Pixel (2,2) is not a low-resolution sample centre, so all four candidates
    // can disagree with it. Keep the real per-pixel raymarch in both directions.
    for (const [name, current, neighbours] of [
      ['sky without matching taps raymarches', 1, foreground],
      ['foreground without matching taps raymarches', foreground, 1]
    ] as const) {
      depths.fill(neighbours)
      depths[2 * 4 + 2] = current
      const native = render(false).slice(40, 44)
      if (Math.abs(native[0] - background.r) < 0.005) throw new Error('Raymarch witness is empty')
      check(name, render(true), 2, 2, native)
    }
    return results
  } finally {
    volume.unbindLowResolution()
    volume.unbindSceneDepth()
    volume.dispose(); volume.geometry.dispose(); volume.material.dispose()
    field.dispose(); low.dispose(); depth.dispose(); target.dispose(); renderer.dispose()
  }
}
