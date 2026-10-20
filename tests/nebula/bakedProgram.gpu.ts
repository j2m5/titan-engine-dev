import {
  Data3DTexture, DataUtils, FloatType, HalfFloatType, PerspectiveCamera, RGFormat,
  Scene, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'

const SIZE = 64

/** Exercise real linked programs: readiness must remove procedural uniforms,
 * return to the cached fallback on invalidation, and keep program ownership bounded. */
export function checkNebulaBakedProgram(): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0, 0)
  const gl = renderer.getContext()
  const scene = new Scene(), camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.z = 3
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const params = mergeNebulaParams({
    seed: 42, noise: { octaves: 2, worleyStrength: 0 },
    lighting: { starPosition: new Vector3(0.25, 0.4, 2), anisotropy: 0.4, shadowStrength: 1 },
    quality: { maxSteps: 16, lightSteps: 2 }
  })
  const volume = new NebulaVolume(params), second = new NebulaVolume(params)
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: HalfFloatType })
  const textures = [[0.4, 0.7], [0.2, 0.1]].map(channels => {
    // Nonuniform channels exercise coordinates in both the view and shadow rays.
    const texture = new Data3DTexture(Float32Array.from({ length: 16 },
      (_, i) => channels[i % 2] * (0.25 + 0.75 * ((i * 5) % 16) / 15)), 2, 2, 2)
    texture.format = RGFormat
    texture.type = FloatType
    texture.needsUpdate = true
    return texture
  })
  const draw = () => {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Missing linked nebula program')
    const uniforms = Array.from({ length: gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number },
      (_, index) => gl.getActiveUniform(program, index)!.name)
    const pixels = new Uint16Array(SIZE * SIZE * 4)
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels)
    let signal = 0
    for (const half of pixels) {
      const value = DataUtils.fromHalfFloat(half)
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid density-program output')
      signal += value
    }
    if (signal < 1 || gl.getError() !== gl.NO_ERROR) throw new Error('Empty or invalid density-program frame')
    return { program, uniforms, pixels }
  }
  const samePixels = (a: Uint16Array, b: Uint16Array) => a.every((value, index) => value === b[index])
  scene.add(volume)
  let programs = 0, fallbacks = 0, retained = 0, parityError = 0
  try {
    const live = draw()
    if (!live.uniforms.includes('uNoiseOffset')) throw new Error('Procedural fallback was not exercised')
    volume.material.setBakedDensityTexture(textures[0])
    const baked = draw()
    if (baked.program === live.program || !baked.uniforms.includes('uDensityTex') ||
        baked.uniforms.includes('uNoiseOffset') || baked.uniforms.includes('uDensityReady')) {
      throw new Error('Ready density still uses the procedural GPU program')
    }
    programs = renderer.info.programs?.length ?? 0
    if (programs !== 2) throw new Error(`Expected two cached density variants, got ${programs}`)

    // Keep the same complete texture and uniforms, but select the previous
    // hybrid program as an independent reference for the specialized sampler.
    delete volume.material.defines.NEB_BAKED_ONLY
    volume.material.needsUpdate = true
    const hybrid = draw()
    for (let i = 0; i < baked.pixels.length; i++) {
      parityError = Math.max(parityError, Math.abs(DataUtils.fromHalfFloat(baked.pixels[i]) - DataUtils.fromHalfFloat(hybrid.pixels[i])))
    }
    if (hybrid.program !== live.program || parityError !== 0) throw new Error(`Specialized/hybrid HDR mismatch: ${parityError}`)
    volume.material.setBakedDensityTexture(textures[0])

    const readyVersion = volume.material.version
    volume.material.setBakedDensityTexture(textures[0])
    const rebound = draw()
    if (rebound.program !== baked.program || !samePixels(rebound.pixels, baked.pixels)) throw new Error('Identical density binding changed the program/image')
    volume.material.setBakedDensityTexture(textures[1])
    const replaced = draw()
    if (volume.material.version !== readyVersion || replaced.program !== baked.program || samePixels(replaced.pixels, baked.pixels)) {
      throw new Error('Texture replacement recompiled or failed to update the density')
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      volume.material.setBakedDensityTexture(null)
      const fallback = draw()
      if (fallback.program !== live.program || !samePixels(fallback.pixels, live.pixels)) throw new Error('Density invalidation did not restore the live field')
      fallbacks++
      volume.material.setBakedDensityTexture(textures[0])
      const ready = draw()
      if (ready.program !== baked.program || !samePixels(ready.pixels, baked.pixels) || renderer.info.programs?.length !== programs) {
        throw new Error('Rebaking accumulated GPU programs or changed the ready image')
      }
    }
    scene.remove(volume)
    scene.add(second)
    second.material.setBakedDensityTexture(textures[0])
    const shared = draw()
    if (shared.program !== baked.program || renderer.info.programs?.length !== programs || !samePixels(shared.pixels, baked.pixels)) {
      throw new Error('A second nebula did not share the ready-density program')
    }
  } finally {
    renderer.setRenderTarget(null)
    for (const item of [volume, second]) { item.dispose(); item.geometry.dispose(); item.material.dispose() }
    for (const texture of textures) texture.dispose()
    target.dispose()
    retained = renderer.info.programs?.length ?? 0
    renderer.dispose()
    renderer.forceContextLoss()
  }
  if (retained !== 0) throw new Error(`Disposed nebulas retained ${retained} GPU programs`)
  return { programs, fallbacks, parityError }
}
