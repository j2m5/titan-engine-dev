import {
  DataUtils, HalfFloatType, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { BloomEffect, Effect, EffectComposer, RenderPass } from 'postprocessing'
import { createEffectPasses } from '@/core/graphic/Postprocessing'
import type { Actor } from '@/core/models/Actor'
import { Star } from '@/core/renderables/Star'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShell } from '@/core/renderables/GiantStar/GiantStarShell'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { BlackHolePass } from '@/core/graphic/passes/BlackHolePass'
import { LensRegistry } from '@/core/services/LensRegistry'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { gaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'

interface BloomMeasurement {
  name: string
  pixelRatio: number
  coverage: number
  cornerToPeak: number
  maxDimming: number
  maxAdditionToPeak: number
  exteriorGlow: number
}

const FIXTURES = [
  { name: 'red-main', kind: 'main', temperature: 3354, radius: 271000 },
  { name: 'sun', kind: 'main', temperature: 5778, radius: 696000 },
  { name: 'hot-main', kind: 'main', temperature: 9940, radius: 1192248 },
  { name: 'white-dwarf', kind: 'white', temperature: 25000, radius: 6000 },
  // Фабрика пульсара использует WhiteDwarf для его горячей фотосферы.
  { name: 'pulsar-surface', kind: 'white', temperature: 900000, radius: 10 },
  { name: 'brown-dwarf', kind: 'brown', temperature: 1800, radius: 70000 },
  { name: 'red-giant', kind: 'giant', temperature: 3700, radius: 1.06e9 },
  { name: 'hot-giant', kind: 'giant', temperature: 12000, radius: 1.06e8 },
  { name: 'accretion-disk', kind: 'hole', temperature: 15000, radius: 0 }
] as const

/**
 * Реальные материалы → HDR → bloom из production-фабрики. Изолируем его
 * вклад, обнуляя opacity остальных эффектов (в том числе тонмаппинга).
 * Ловит возврат фоновой засветки, SCREEN-затемнение HDR и выключенный bloom.
 * Рендеры имеют одинаковый угловой размер при DPR 1/2; пороги — визуальные
 * бюджеты, а не точные значения настроек/снимков конкретного GPU.
 *
 * Vite / WebGL2:
 * await import('/tests/graphic/stellarBloom.gpu.ts').then(m => m.checkStellarBloom())
 */
export function checkStellarBloom(): { results: BloomMeasurement[] } {
  const originalGaiaExposure = gaiaSkyUniforms.uGaiaExposure.value
  const width = 640, height = 360
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setClearColor(0, 1)
  renderer.setSize(width, height)
  const camera = new PerspectiveCamera(50, width / height, 0.000001, 1e12)
  const scene = new Scene(), registry = new LensRegistry()
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType })
  composer.autoRenderToScreen = false
  composer.addPass(new RenderPass(scene, camera))
  const holePass = new BlackHolePass(camera, registry)
  composer.addPass(holePass)
  if (holePass.skyLayer.material.uniforms.uGaiaExposure) holePass.skyLayer.material.uniforms.uGaiaExposure = { value: 0 }
  const [hdr, ldr] = createEffectPasses(camera)
  const effects = (hdr as unknown as { effects: Effect[] }).effects
  if (!effects.some(effect => effect instanceof BloomEffect)) throw new Error('Production bloom missing')
  for (const effect of effects) if (!(effect instanceof BloomEffect)) effect.blendMode.opacity.value = 0
  hdr.initialize(renderer, false, HalfFloatType)
  const output = new WebGLRenderTarget(width, height, { type: HalfFloatType })
  const results: BloomMeasurement[] = []
  const failures: string[] = [], shaderErrors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment): void => {
    shaderErrors.push(gl.getProgramInfoLog(program) ?? '', gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
  }

  try {
    for (const pixelRatio of [1, 2]) {
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height)
      composer.setSize(width, height)
      const w = width * pixelRatio, h = height * pixelRatio
      hdr.setSize(w, h)
      output.setSize(w, h)
      const before = new Uint16Array(w * h * 4), after = new Uint16Array(w * h * 4)
      for (const fixture of FIXTURES) {
        const actor = {
          rotation: null,
          getAttribute: (key: string, fallback?: unknown): unknown => key === 'categoryId' ? 10 : fallback,
          renderingObject: { getAttribute: (): object => ({ diskFarGain: 1 }) },
          physicalObject: {
            getAttribute: (key: string, fallback?: unknown): unknown =>
              ({ temperature: fixture.temperature, radius: fixture.radius, mass: 8.54e36 } as Record<string, number>)[key] ?? fallback
          }
        } as unknown as Actor
        const body = fixture.kind === 'hole'
          ? new BlackHole(actor, { sceneBackground: null } as unknown as ResourceObserver, registry)
          : fixture.kind === 'white' ? new WhiteDwarf(actor)
          : fixture.kind === 'brown' ? new BrownDwarf(actor)
          : fixture.kind === 'giant' ? new GiantStar(actor) : new Star(actor)
        if (body.material.uniforms.uGaiaExposure) body.material.uniforms.uGaiaExposure = { value: 0 }
        const shell = body instanceof GiantStar ? new GiantStarShell(body) : null
        if (shell) body.add(shell)
        scene.add(body)
        try {
          for (const coverage of [0.06, 0.7]) {
            const radius = toThreeJSUnits(body instanceof BlackHole ? body.parameters.diskOuterRadius : fixture.radius)
            const distance = radius * Math.sqrt(1 + 1 / (coverage * Math.tan(camera.fov * Math.PI / 360)) ** 2)
            camera.position.set(0, body instanceof BlackHole ? distance * 0.32 : 0,
              body instanceof BlackHole ? distance * Math.sqrt(1 - 0.32 ** 2) : distance)
            camera.lookAt(0, 0, 0)
            camera.updateMatrixWorld(true)
            body.updateObject({ camera, elapsed: 123, delta: 0, epoch: 0 })
            shell?.updateObject({ camera, elapsed: 123, delta: 0, epoch: 0 })
            scene.updateMatrixWorld(true)
            composer.render(0)
            renderer.readRenderTargetPixels(composer.inputBuffer, 0, 0, w, h, before)
            hdr.render(renderer, composer.inputBuffer, output, 0, false)
            renderer.readRenderTargetPixels(output, 0, 0, w, h, after)
            const glError = renderer.getContext().getError()
            if (glError || shaderErrors.length) throw new Error(`Bloom WebGL ${glError}: ${shaderErrors.join('\n')}`)

            let peak = 0, corner = 0, cornerCount = 0, maxDimming = 0, maxAddition = 0, exteriorGlow = 0
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4
              let sourceMax = 0, glow = 0
              for (let c = 0; c < 3; c++) {
                const source = DataUtils.fromHalfFloat(before[i + c]), processed = DataUtils.fromHalfFloat(after[i + c])
                if (!Number.isFinite(processed) || processed < 0) throw new Error(`${fixture.name}: invalid bloom ${processed}`)
                peak = Math.max(peak, source)
                sourceMax = Math.max(sourceMax, source)
                maxDimming = Math.max(maxDimming, (source - processed) / Math.max(1, source))
                maxAddition = Math.max(maxAddition, processed - source)
                glow += processed - source
              }
              if (sourceMax < 0.00001) exteriorGlow += glow
              if ((x < w * 0.12 || x > w * 0.88) && (y < h * 0.2 || y > h * 0.8)) {
                corner += glow / 3
                cornerCount++
              }
            }
            if (peak < 1) throw new Error(`${fixture.name}: fixture has no HDR source`)
            const cornerToPeak = corner / cornerCount / peak
            const maxAdditionToPeak = maxAddition / peak
            const key = `${fixture.name}, DPR ${pixelRatio}, coverage ${coverage}`
            results.push({ name: fixture.name, pixelRatio, coverage, cornerToPeak, maxDimming, maxAdditionToPeak, exteriorGlow })
            // Принятый bloom (7 уровней, intensity 0.6): фон до 2%, добавка до 60% пика.
            // SwiftShader: максимумы 1.66% и 55.6%; бюджеты оставляют запас для других GPU.
            if (cornerToPeak > 0.02) failures.push(`${key}: background ${cornerToPeak} > 0.02`)
            // Допуск затемнения 0.2% по-прежнему покрывает только half-float округление.
            if (maxDimming > 0.002) failures.push(`${key}: dimming ${maxDimming} > 0.002`)
            if (maxAdditionToPeak > 0.6) failures.push(`${key}: added light ${maxAdditionToPeak} > 0.6`)
            if (exteriorGlow <= 0.0001) failures.push(`${key}: exterior glow missing`)
          }
        } finally {
          scene.remove(body)
          shell?.dispose()
          if (!(body instanceof Star)) body.dispose()
          else { body.geometry.dispose(); body.material.dispose() }
          // BlackHole.dispose снимает запись реестра, ресурсы меша принадлежат фабрике.
          if (body instanceof BlackHole) { body.geometry.dispose(); body.material.dispose() }
        }
      }
    }
    if (gaiaSkyUniforms.uGaiaExposure.value !== originalGaiaExposure) {
      throw new Error('Stellar bloom probe changed the shared Gaia exposure')
    }
    if (failures.length) throw Object.assign(new Error(failures.join('\n')), { results })
    return { results }
  } finally {
    gaiaSkyUniforms.uGaiaExposure.value = originalGaiaExposure
    hdr.dispose()
    ldr.dispose()
    output.dispose()
    composer.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
