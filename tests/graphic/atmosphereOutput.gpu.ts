import {
  BasicDepthPacking, Color, HalfFloatType, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, Scene, SphereGeometry, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { DepthCopyPass, Effect, EffectPass } from 'postprocessing'
import { RenderingObjects } from '@storage/database'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { SpaceScale } from '@/core/constants'
import { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { LensRegistry } from '@/core/services/LensRegistry'

/** Exact active-atmosphere color/depth parity through the actual ten-pass pipeline. */
export function checkAtmosphereOutput(): unknown {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(128, 72)
  const gl = renderer.getContext() as WebGL2RenderingContext
  const camera = new PerspectiveCamera(55, 128 / 72, 0.1, 100), scene = new Scene()
  const atmospheres = new AtmosphereRegistry(), lenses = new LensRegistry(), lens = new Object3D()
  lens.position.set(0.8, 0.04, -5)
  scene.add(lens)
  lenses.register({ object: lens, rsUnits: 0.04, simulationRadiusUnits: 0.15, background: () => null })
  const config = RenderingObjects.find(row => row.actorId === 47)!.data as unknown as AtmosphereConfig
  const generator = new AtmosphereLUTGenerator(renderer), lut = generator.generate(config)
  const planet = new Mesh(new SphereGeometry(config.bottomRadius * SpaceScale, 32, 16),
    new MeshBasicMaterial({ color: new Color(2, 0.6, 0.3) }))
  planet.position.set(-0.2, 0.1, -12)
  scene.add(planet); scene.updateMatrixWorld(true); camera.updateMatrixWorld(true)
  const entry = { actorId: 47, name: 'Earth fixture', object: planet, config, lut }
  const originalBlit = gl.blitFramebuffer
  let blits = 0
  gl.blitFramebuffer = function (...args) { blits++; return originalBlit.apply(this, args) }
  const results: unknown[] = []
  try {
    for (const samples of [8, 4]) {
      const pp = new Postprocessing(renderer, scene, camera, atmospheres, new DepthVolumeRegistry(), lenses)
      pp.initialize()
      const composer = pp.composer!
      composer.multisampling = samples
      const atmosphere = composer.passes[7] as EffectPass
      const effect = (atmosphere as unknown as { effects: AtmosphereEffect[] }).effects[0]
      const copy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
      copy.initialize(renderer, false, HalfFloatType)
      copy.setDepthTexture(atmosphere.getDepthTexture())
      const renderAtmosphere = atmosphere.render
      let inactiveHdr: Uint16Array | null = null
      try {
        for (const [width, height, activeAtmosphere, activeLens] of [
          [128, 72, false, false], [128, 72, true, false],
          [256, 144, true, true], [128, 72, true, false]
        ] as const) {
          if (activeAtmosphere) atmospheres.register(entry); else atmospheres.unregister(entry.actorId)
          lens.visible = activeLens
          composer.setSize(width, height); copy.setSize(width, height)
          const draw = (candidate: boolean) => {
            let hdr = new Uint16Array(), resolves = -1, actualSamples = -1
            atmosphere.render = function (...args) {
              const before = blits
              ;(candidate ? renderAtmosphere : EffectPass.prototype.render).apply(this, args)
              resolves = blits - before
              const target = renderer.getRenderTarget()!
              actualSamples = gl.getParameter(gl.SAMPLES) as number
              hdr = new Uint16Array(width * height * 4)
              renderer.readRenderTargetPixels(target, 0, 0, width, height, hdr)
            }
            for (let i = 0; i < 3; i++) composer.render(0)
            const rgba = new Uint8Array(width * height * 4)
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
            copy.render(renderer, composer.inputBuffer, null)
            const depth = new Float32Array(width * height * 4)
            renderer.readRenderTargetPixels((copy as unknown as { renderTarget: WebGLRenderTarget }).renderTarget, 0, 0, width, height, depth)
            if (gl.getError() !== gl.NO_ERROR) throw new Error('Atmosphere output WebGL error')
            if (!rgba.some((v, i) => i % 4 !== 3 && v > 0)) throw new Error('Black atmosphere image')
            const redDepth = depth.filter((_v, i) => i % 4 === 0)
            if (redDepth.some(v => !Number.isFinite(v) || v < 0 || v > 1) ||
              !redDepth.some(v => v < 1) || !redDepth.some(v => v === 1)) throw new Error('Invalid atmosphere scene depth')
            return { hdr, rgba, depth, resolves, actualSamples }
          }
          const before = draw(false), candidate = draw(true), after = draw(false)
          for (const value of [candidate, after]) for (const key of ['hdr', 'rgba', 'depth'] as const) {
            if (before[key].length !== value[key].length || before[key].some((v, i) => v !== value[key][i])) {
              throw new Error(`Atmosphere ${key} differs: samples=${samples}, width=${width}, active=${activeAtmosphere}, lens=${activeLens}`)
            }
          }
          if (before.resolves !== 1 || candidate.resolves !== 0 || candidate.actualSamples !== 0) throw new Error('Atmosphere resolve was not removed')
          if (effect.slotCount !== Number(activeAtmosphere)) throw new Error('Atmosphere slots not exercised')
          const lensEffect = (composer.passes[4] as unknown as { effects: Effect[] }).effects[0]
          if (lensEffect.uniforms.get('uCount')!.value !== Number(activeLens)) throw new Error('Lens transition not exercised')
          if (!activeAtmosphere) inactiveHdr = before.hdr
          if (activeAtmosphere && !activeLens && width === 128 && !before.hdr.some((v, i) => v !== inactiveHdr![i])) {
            throw new Error('Active atmosphere did not affect the image')
          }
          results.push({ samples, width, height, activeAtmosphere, activeLens, baselineSamples: before.actualSamples,
            candidateSamples: candidate.actualSamples, baselineResolves: before.resolves, candidateResolves: candidate.resolves,
            hdrDifferences: 0, rgbaDifferences: 0, depthDifferences: 0 })
        }
      } finally {
        atmosphere.render = renderAtmosphere
        copy.dispose(); pp.dispose(); atmospheres.unregister(entry.actorId)
      }
    }
    generator.dispose()
    if (renderer.info.memory.textures !== 0 || renderer.info.programs!.length !== 1) throw new Error('Atmosphere output resource leak')
    return { results }
  } finally {
    gl.blitFramebuffer = originalBlit
    generator.dispose(); planet.geometry.dispose(); planet.material.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
