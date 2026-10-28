import {
  BasicDepthPacking, Color, HalfFloatType, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { DepthCopyPass, Effect, EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import { createEffectPasses } from '@/core/graphic/Postprocessing'
import { createGravitationalLensPass } from '@/core/graphic/effects/lens/GravitationalLensEffect'
import { LensRegistry } from '@/core/services/LensRegistry'

/** Exact terminal color/depth parity, including an active lens and resize/restore. */
export function checkTerminalEffects(): unknown {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(128, 72)
  const gl = renderer.getContext() as WebGL2RenderingContext
  const camera = new PerspectiveCamera(55, 128 / 72, 0.1, 100)
  const scene = new Scene(), registry = new LensRegistry(), lens = new Object3D()
  lens.position.set(0.12, 0.04, -2)
  scene.add(lens)
  registry.register({ object: lens, rsUnits: 0.04, simulationRadiusUnits: 0.15, background: () => null })
  const mesh = new Mesh(new PlaneGeometry(2.3, 1.7), new MeshBasicMaterial({ color: new Color(4, 1.4, 0.3) }))
  mesh.position.set(-0.18, 0.07, -4)
  mesh.rotation.z = 0.21
  scene.add(mesh)
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  const blit = gl.blitFramebuffer
  let blits = 0
  gl.blitFramebuffer = function (...args) { blits++; return blit.apply(this, args) }
  const results: unknown[] = []
  try {
    for (const samples of [0, 4, 8]) {
      const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: samples })
      const lensPass = createGravitationalLensPass(camera, registry)
      const [hdr, ldr] = createEffectPasses(camera)
      composer.addPass(new RenderPass(scene, camera))
      composer.addPass(lensPass)
      composer.addPass(hdr)
      composer.addPass(ldr)
      const copy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
      copy.initialize(renderer, false, HalfFloatType)
      copy.setDepthTexture(lensPass.getDepthTexture())
      const hdrRender = hdr.render, ldrRender = ldr.render
      try {
        for (const [width, height, active] of [[128, 72, false], [256, 144, true], [128, 72, false]] as const) {
          lens.visible = active
          composer.setSize(width, height)
          copy.setSize(width, height)
          const draw = (candidate: boolean) => {
            let hdrPixels = new Uint16Array(), terminalResolves = -1, actualSamples = -1
            hdr.render = function (...args) {
              const before = blits
              ;(candidate ? hdrRender : EffectPass.prototype.render).apply(this, args)
              terminalResolves = blits - before
              const target = renderer.getRenderTarget()!
              actualSamples = gl.getParameter(gl.SAMPLES) as number
              hdrPixels = new Uint16Array(width * height * 4)
              renderer.readRenderTargetPixels(target, 0, 0, width, height, hdrPixels)
            }
            ldr.render = candidate ? ldrRender : EffectPass.prototype.render
            for (let frame = 0; frame < 3; frame++) composer.render(0)
            const rgba = new Uint8Array(width * height * 4)
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
            copy.render(renderer, composer.inputBuffer, null)
            const depth = new Float32Array(width * height * 4)
            renderer.readRenderTargetPixels((copy as unknown as { renderTarget: WebGLRenderTarget }).renderTarget, 0, 0, width, height, depth)
            if (gl.getError() !== gl.NO_ERROR) throw new Error('Terminal output WebGL error')
            if (!rgba.some((value, i) => i % 4 !== 3 && value > 0)) throw new Error('Black terminal image')
            const redDepth = depth.filter((_value, i) => i % 4 === 0)
            if (redDepth.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
              !redDepth.some(value => value < 1) || !redDepth.some(value => value === 1)) throw new Error('Invalid scene depth fixture')
            return { hdr: hdrPixels, rgba, depth, terminalResolves, actualSamples }
          }
          const before = draw(false), candidate = draw(true), after = draw(false)
          for (const result of [candidate, after]) for (const key of ['hdr', 'rgba', 'depth'] as const) {
            if (before[key].length !== result[key].length || before[key].some((value, i) => value !== result[key][i])) {
              throw new Error(`Terminal ${key} differs: samples=${samples}, size=${width}, lens=${active}`)
            }
          }
          if (before.terminalResolves !== (samples ? 1 : 0) || candidate.terminalResolves !== 0 || candidate.actualSamples !== 0) {
            throw new Error('Terminal resolve was not removed')
          }
          const effect = (lensPass as unknown as { effects: Effect[] }).effects[0]
          if (effect.uniforms.get('uCount')!.value !== Number(active)) throw new Error('Lens transition not exercised')
          results.push({ samples, width, height, active, baselineSamples: before.actualSamples, candidateSamples: candidate.actualSamples, baselineResolves: before.terminalResolves, candidateResolves: candidate.terminalResolves, hdrDifferences: 0, rgbaDifferences: 0, depthDifferences: 0 })
        }
      } finally {
        hdr.render = hdrRender
        ldr.render = ldrRender
        copy.dispose()
        composer.dispose()
      }
    }
    if (renderer.info.memory.textures !== 0 || renderer.info.programs!.length !== 1) {
      // The one remaining program belongs to the scene mesh, not postprocessing.
      throw new Error(`Terminal resource leak: ${JSON.stringify({ memory: renderer.info.memory, programs: renderer.info.programs!.length })}`)
    }
    return { results }
  } finally {
    gl.blitFramebuffer = blit
    mesh.geometry.dispose()
    mesh.material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
