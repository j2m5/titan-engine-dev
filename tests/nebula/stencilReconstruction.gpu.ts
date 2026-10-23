import {
  Color, Data3DTexture, DataTexture, DataUtils, FloatType, HalfFloatType, Mesh, NoBlending, Object3D, OrthographicCamera, PerspectiveCamera,
  PlaneGeometry, RedFormat, RGBAFormat, RGFormat, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { DepthVolumeReconstructionRenderer } from '@/core/graphic/passes/DepthVolumeReconstructionRenderer'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'

function contextEvent(canvas: HTMLCanvasElement, name: string, trigger: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(timer); canvas.removeEventListener(name, listener) }
    const listener = (): void => { cleanup(); resolve() }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${name}`)) }, 10000)
    canvas.addEventListener(name, listener, { once: true })
    try { trigger() } catch (error) { cleanup(); reject(error) }
  })
}

/** Compare the production stencil + composition path with the original combined
 * shader, using identical low HDR/depth inputs and a nonzero scene background. */
export async function checkNebulaStencilReconstruction() {
  const renderer = new WebGLRenderer({ antialias: false, stencil: false })
  renderer.autoClear = false
  const reconstruction = new DepthVolumeReconstructionRenderer()
  const camera = new PerspectiveCamera(50, 1, .01, 100)
  const volume = new NebulaVolume(mergeNebulaParams({
    lighting: { scatterStrength: 0 }, quality: { maxSteps: 16, resolutionScale: .5 }
  }))
  const parent = new Object3D(); parent.add(volume)
  const frame = new Object3D(); frame.scale.setScalar(2); parent.add(frame)
  const field = new Data3DTexture(Float32Array.from({ length: 16 }, (_, i) => i % 2 ? .7 : .4), 2, 2, 2)
  field.format = RGFormat; field.type = FloatType; field.needsUpdate = true
  const impostor = new DataTexture(new Float32Array([.2, .1, .4, .35]), 1, 1, RGBAFormat, FloatType)
  impostor.needsUpdate = true; volume.setImpostor(impostor, frame)
  camera.layers.mask = volume.layers.mask
  const background = new Color(.125, .25, .5), logFar = Math.log2(101)
  // A slanted silhouette leaves different background colors in MSAA samples.
  const backgroundMesh = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    depthTest: false, depthWrite: false, blending: NoBlending,
    vertexShader: 'void main(){gl_Position=vec4(position.x*.4+position.y*.2,position.y*.8,0.,1.);}',
    fragmentShader: 'void main(){gl_FragColor=vec4(.7,1.25,.3,.6);}'
  })), backgroundCamera = new OrthographicCamera()
  const results: Record<string, number | boolean> = {}
  let target: WebGLRenderTarget | undefined, depth: DataTexture | undefined, low: DataTexture | undefined
  let usedStencil = 0
  const draw = renderer.render.bind(renderer)
  renderer.render = (object, view) => {
    if (renderer.getRenderTarget()?.texture.name === 'DepthVolume stencil reconstruction') usedStencil++
    draw(object, view)
  }
  const read = (): Float32Array => {
    const count = target!.width * target!.height * 4
    const raw = target!.texture.type === FloatType ? new Float32Array(count) : new Uint16Array(count)
    renderer.readRenderTargetPixels(target!, 0, 0, target!.width, target!.height, raw)
    if (renderer.getContext().getError()) throw new Error('Stencil reconstruction WebGL error')
    const pixels = raw instanceof Float32Array ? raw : Float32Array.from(raw, DataUtils.fromHalfFloat)
    if (pixels.some(value => !Number.isFinite(value))) throw new Error('Nonfinite reconstructed HDR')
    return pixels
  }
  const render = (optimized: boolean, maskedClear = false, expectStencil = true): Float32Array => {
    renderer.setRenderTarget(target!)
    renderer.setClearColor(background, .75)
    renderer.clear(true, true, true)
    if (target!.samples > 0) draw(backgroundMesh, backgroundCamera)
    if (maskedClear) renderer.state.buffers.color.setMask(false)
    if (optimized) renderer.state.buffers.stencil.setClear(1)
    const accepted = optimized && reconstruction.render(renderer, target!, camera, volume, new Vector2(target!.width, target!.height))
    if (optimized) {
      const gl = renderer.getContext()
      if (gl.getParameter(gl.STENCIL_CLEAR_VALUE) !== 1) throw new Error('Caller stencil clear value was changed')
      renderer.state.buffers.stencil.setClear(0)
    }
    if (!accepted) draw(volume, camera)
    if (optimized && accepted !== expectStencil) throw new Error('Unexpected stencil/fallback selection')
    return read()
  }
  const compare = (name: string, maskedClear = false, expectStencil = true): Float32Array => {
    const reference = render(false), actual = render(true, maskedClear, expectStencil)
    const rb = new Uint32Array(reference.buffer), ab = new Uint32Array(actual.buffer)
    let changed = 0, different = 0, maxError = 0
    for (let i = 0; i < rb.length; i++) {
      if (rb[i] !== ab[i]) different++
      maxError = Math.max(maxError, Math.abs(reference[i] - actual[i]))
      if (Math.abs(reference[i] - [.125, .25, .5, .75][i % 4]) > .01) changed++
    }
    results[`${name}/differentBits`] = different
    results[`${name}/maxError`] = maxError
    if (different) throw new Error(`${name}: ${different} HDR components changed, max=${maxError}`)
    if (!changed && !name.includes('empty')) throw new Error(`${name}: empty witness`)
    return actual
  }
  try {
    for (const [width, height, type] of [[32, 24, FloatType], [31, 23, HalfFloatType]] as const) {
      renderer.setRenderTarget(null); target?.dispose(); depth?.dispose(); low?.dispose()
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix()
      target = new WebGLRenderTarget(width, height, { type, depthBuffer: true })
      const values = new Float32Array(width * height).fill(1)
      depth = new DataTexture(values, width, height, RedFormat, FloatType)
      const lw = Math.ceil(width / 2), lh = Math.ceil(height / 2)
      const colors = Float32Array.from({ length: lw * lh * 4 }, (_, i) =>
        i % 4 === 3 ? .375 : (i % 29) / 16)
      low = new DataTexture(colors, lw, lh, RGBAFormat, FloatType); low.needsUpdate = true
      volume.bindSceneDepth(depth, new Vector2(width, height), logFar)
      volume.bindLowResolution(low, new Vector2(lw, lh))
      for (const baked of [false, true]) {
        volume.material.setBakedDensityTexture(baked ? field : null)
        for (const pose of ['inside', 'outside', 'near-plane', 'translated-parent'] as const) {
          parent.position.set(0, 0, 0); parent.rotation.set(0, 0, 0); parent.scale.set(1, 1, 1)
          camera.position.set(.1, .05, pose === 'outside' ? 6 : pose === 'near-plane' ? 1.995 : .2)
          if (pose === 'translated-parent') {
            parent.position.set(1e8, -2e8, 3e8); parent.rotation.set(.1, .2, -.15); parent.scale.set(1.5, .8, 1.2)
            camera.position.add(parent.position)
          }
          parent.updateMatrixWorld(true); camera.updateMatrixWorld(true)
          for (const pattern of ['all-matched', 'mixed', 'dense-discontinuities'] as const) {
            values.fill(1)
            if (pattern === 'mixed') {
              for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                if (x === 5 || (x > width / 2 && y > height / 2)) values[y * width + x] = Math.log2(1.25) / logFar
              }
            } else if (pattern === 'dense-discontinuities') {
              // Many high-resolution pixels disagree with all their low sample centres.
              for (let i = 0; i < values.length; i++) values[i] = Math.log2(1.2 + (i % 11) * .03) / logFar
            }
            depth.needsUpdate = true
            volume.material.uniforms.uOpacityScale.value = .4
            volume.material.uniforms.uLodBlend.value = .5
            compare(`${width}/${baked}/${pose}/${pattern}`)
          }
        }
      }
      parent.position.set(0, 0, 0); parent.rotation.set(0, 0, 0); parent.scale.set(1, 1, 1)
      camera.position.set(.1, .05, .2); camera.updateMatrixWorld(true); parent.updateMatrixWorld(true)
      volume.material.uniforms.uLodBlend.value = 1
      values.fill(1); depth.needsUpdate = true
      compare(`${width}/before-clear-mask`)
      camera.position.z = 6; camera.updateMatrixWorld(true)
      compare(`${width}/clear-mask`, true)
      camera.position.z = .2; camera.updateMatrixWorld(true)
      // Transparent emission in the supplied low image must still add RGB.
      for (let i = 3; i < colors.length; i += 4) colors[i] = 0
      low.needsUpdate = true
      compare(`${width}/emission`)
      // Alternate nonempty and empty frames to detect a stale scratch/stencil mask.
      colors.fill(0); low.needsUpdate = true
      compare(`${width}/empty`)
      compare(`${width}/empty-repeat`)
    }
    // One shared target/program pair must remain bounded across repeated draws.
    compare('empty-before-reuse')
    const textures = renderer.info.memory.textures, programs = renderer.info.programs!.length
    for (let i = 0; i < 10; i++) render(true)
    if (renderer.info.memory.textures !== textures || renderer.info.programs!.length !== programs) throw new Error('Stencil resources grew while reusing a volume')
    results.steadyTextures = textures; results.steadyPrograms = programs
    const restoredLow = low!.image.data as Float32Array, restoredDepth = depth!.image.data as Float32Array
    for (let i = 0; i < restoredLow.length; i++) restoredLow[i] = i % 4 === 3 ? .375 : (i % 29) / 16
    for (let i = 0; i < restoredDepth.length; i++) restoredDepth[i] = i % 7 ? 1 : Math.log2(1.25) / logFar
    low!.needsUpdate = true; depth!.needsUpdate = true
    for (const samples of [4, 8]) {
      renderer.setRenderTarget(null); target!.dispose()
      target = new WebGLRenderTarget(31, 23, { type: HalfFloatType, depthBuffer: true, samples })
      for (const yaw of [0, .45, 1.5, 2.8]) {
        camera.rotation.set(0, yaw, 0); camera.updateMatrixWorld(true)
        compare(`MSAA${samples}/inside/${yaw}`)
      }
      camera.rotation.set(0, 0, 0); camera.position.z = 6; camera.updateMatrixWorld(true)
      compare(`MSAA${samples}/outside fallback`, false, false)
      camera.position.set(1.9999, .05, .2); camera.updateMatrixWorld(true)
      compare(`MSAA${samples}/near-edge fallback`, false, false)
      camera.position.set(.1, .05, .2); camera.updateMatrixWorld(true)
      camera.far = 1.5; camera.updateProjectionMatrix()
      compare(`MSAA${samples}/far-clip fallback`, false, false)
      camera.far = 100; camera.updateProjectionMatrix()
      target.viewport.set(1, 1, 29, 21)
      compare(`MSAA${samples}/cropped fallback`, false, false)
      target.viewport.set(0, 0, 31, 23)
      volume.material.alphaToCoverage = true
      compare(`MSAA${samples}/alpha-to-coverage fallback`, false, false)
      volume.material.alphaToCoverage = false
    }
    const before = compare('before-context-restoration')
    renderer.setRenderTarget(null)
    await contextEvent(renderer.domElement, 'webglcontextlost', () => renderer.forceContextLoss())
    await new Promise(resolve => setTimeout(resolve, 100))
    await contextEvent(renderer.domElement, 'webglcontextrestored', () => renderer.forceContextRestore())
    const restored = render(true)
    if (before.some((value, i) => value !== restored[i])) throw new Error('Stencil image changed after context restoration')
    results.restoredIdentically = true
    const beforeDispose = renderer.info.memory.textures
    reconstruction.prepare([])
    if (renderer.info.memory.textures !== beforeDispose - 1) throw new Error('Reconstruction retained its scratch target')
    results.scratchReleased = true; results.stencilDraws = usedStencil
    if (usedStencil < 100) throw new Error('Production stencil path was not exercised')
    return results
  } finally {
    renderer.setRenderTarget(null); reconstruction.dispose()
    volume.unbindLowResolution(); volume.unbindSceneDepth()
    volume.dispose(); volume.geometry.dispose(); volume.material.dispose()
    field.dispose(); impostor.dispose(); low?.dispose(); depth?.dispose(); target?.dispose()
    backgroundMesh.geometry.dispose(); backgroundMesh.material.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
