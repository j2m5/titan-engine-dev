import {
  BasicDepthPacking, DataUtils, DepthTexture, HalfFloatType, PerspectiveCamera, Scene,
  UnsignedIntType, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { RenderingObjects } from '@storage/database/renderingObjects'
import { nebulaParamsFromData, type NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DepthVolumePass } from '@/core/graphic/passes/DepthVolumePass'
import { GpuTimer } from '../browser/gpuTimer'
import { summarizeGpuMs, type BenchmarkOptions } from './benchmarkSupport'

const scenes = { W26: [91], Alkaid: [108], Crab: [114, 117] } as const
export type SceneName = keyof typeof scenes
type Profile = { name: string; scale: number; temporal: number; steps?: number; lightSteps?: number; shadow?: number }
export type BenchmarkCase = { view: 'close' | 'inside'; profile: Profile }
let fixture: ReturnType<typeof createFixture> | undefined

export function setup(name: SceneName, width: number, height: number) {
  dispose()
  fixture = createFixture(name, width, height)
  return fixture.description
}

export function dispose(): void { fixture?.dispose(); fixture = undefined }

export async function runCase(item: BenchmarkCase, options: BenchmarkOptions, preview: boolean) {
  if (!fixture) throw new Error('Nebula benchmark is not initialized')
  return fixture.run(item, options, preview)
}

export async function control(options: BenchmarkOptions) {
  if (!fixture) throw new Error('Nebula benchmark is not initialized')
  return fixture.control(options)
}

function createFixture(name: SceneName, width: number, height: number) {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true, powerPreference: 'high-performance' })
  const cleanup: Array<() => void> = [() => { renderer.dispose(); renderer.forceContextLoss() }]
  const disposeAll = () => { for (const fn of cleanup.splice(0).reverse()) fn() }
  try {
    renderer.autoClear = false
    renderer.setPixelRatio(1)
    renderer.setSize(width, height)
    const context = renderer.getContext()
    if (!(context instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is required for native GPU queries')
    const gl: WebGL2RenderingContext = context
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    if (!debug) throw new Error('Unmasked GPU renderer is required to verify native execution')
    const gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string
    if (/SwiftShader|llvmpipe|software|basic render|softpipe/i.test(gpu)) throw new Error(`Software GPU rejected: ${gpu}`)
    new GpuTimer(gl).dispose() // Fail before baking if native timers are unsupported.

    const source = scenes[name].map(id => {
      const row = RenderingObjects.find(row => row.id === id)
      if (!row) throw new Error(`Missing nebula rendering row ${id}`)
      return { id, data: row.data as NebulaRenderingData }
    })
    const params = source.map(row => nebulaParamsFromData(row.data))
    const outerSize = Math.max(...params.map(p => p.size))
    for (const p of params) p.lighting.starPosition?.divideScalar(outerSize)
    const original = params.map(p => ({ quality: { ...p.quality }, shadow: p.lighting.shadowStrength }))
    const scene = new Scene(), camera = new PerspectiveCamera(50, width / height, 0.01, 100)
    const registry = new DepthVolumeRegistry()
    const pass = new DepthVolumePass(camera, registry)
    cleanup.push(() => pass.dispose())
    const depth = new DepthTexture(width, height, UnsignedIntType)
    const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, depthTexture: depth, samples: 0 })
    cleanup.push(() => { renderer.setRenderTarget(null); target.dispose(); depth.dispose() })
    pass.initialize(renderer, true, HalfFloatType)
    pass.setSize(width, height)
    pass.setDepthTexture(depth, BasicDepthPacking)
    const volumes = params.map(p => {
      const baker = new NebulaDensityBaker(renderer, p.quality.bakeResolution)
      cleanup.push(() => baker.dispose())
      const volume = new NebulaVolume(p, registry)
      cleanup.push(() => { volume.dispose(); volume.geometry.dispose(); volume.material.dispose() })
      volume.scale.setScalar(p.size / outerSize)
      volume.material.setBakedDensityTexture(baker.bake(p))
      scene.add(volume)
      return volume
    })

    const profiles: Profile[] = [
      { name: 'full', scale: 1, temporal: 0 },
      { name: 'half', scale: 0.5, temporal: 0 },
      { name: 'current', scale: 0.5, temporal: 0.85 },
      { name: 'quarter', scale: 0.25, temporal: 0.85 },
      { name: 'steps48', scale: 0.5, temporal: 0.85, steps: 48 }
    ]
    // Crab is emissive without a star: changing lightSteps there would be a no-op.
    if (params.some(p => p.lighting.starPosition && p.lighting.shadowStrength > 0 && p.lighting.scatterStrength > 0)) {
      profiles.push(
        { name: 'no-shadow', scale: 0.5, temporal: 0.85, shadow: 0 },
        { name: 'light2', scale: 0.5, temporal: 0.85, lightSteps: 2 },
        { name: 'light4', scale: 0.5, temporal: 0.85, lightSteps: 4 }
      )
    }
    const cases: BenchmarkCase[] = (['close', 'inside'] as const).flatMap(view => profiles.map(profile => ({ view, profile })))
    const description = {
      name, source, normalizedScales: params.map(p => p.size / outerSize), original,
      environment: { gpu, userAgent: navigator.userAgent, width, height, dpr: 1, timer: 'EXT_disjoint_timer_query_webgl2', samples: target.samples },
      cases
    }

    function prepare(view: BenchmarkCase['view'], frame: number) {
      // Identical small orbit and elapsed time in every case, independent of GPU speed.
      const angle = frame * 0.001, radius = view === 'close' ? 1.42 : 0.2
      camera.position.set(Math.sin(angle) * radius, view === 'close' ? 1.42 : 0.08, Math.cos(angle) * radius)
      camera.lookAt(0, 0, 0)
      renderer.setRenderTarget(target)
      renderer.setClearColor(0, 1)
      renderer.clear()
      renderer.render(scene, camera) // Matrix/depth preparation is outside the timer.
    }
    const draw = () => pass.render(renderer, target, null)

    async function measure(options: BenchmarkOptions, view: BenchmarkCase['view'], draw: () => void) {
      const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      for (let frame = -options.warmup; frame < 0; frame++) {
        await nextFrame(); prepare(view, frame); draw()
      }
      const timer = new GpuTimer(gl), samples: number[] = []
      let submitted = 0, lastProgress = performance.now()
      try {
        while (submitted < options.samples || timer.pendingCount > 0) {
          await nextFrame()
          const ready = timer.poll()
          samples.push(...ready)
          if (ready.length) lastProgress = performance.now()
          if (performance.now() - lastProgress > 15_000) throw new Error('GPU timer query timed out')
          if (submitted < options.samples && timer.pendingCount < 8) {
            prepare(view, submitted++)
            timer.measure(draw)
          }
        }
      } finally { timer.dispose() }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error during nebula benchmark')
      if (samples.length !== options.samples) throw new Error('Incomplete GPU sample batch')
      return samples
    }

    async function run(item: BenchmarkCase, options: BenchmarkOptions, preview: boolean) {
      const p = item.profile
      params.forEach((params, index) => {
        Object.assign(params.quality, original[index].quality, {
          resolutionScale: p.scale, temporalBlend: p.temporal,
          maxSteps: p.steps ?? original[index].quality.maxSteps,
          lightSteps: p.lightSteps ?? original[index].quality.lightSteps
        })
        params.lighting.shadowStrength = p.shadow ?? original[index].shadow
        volumes[index].material.setUniformsFromParams(params)
      })
      const samples = await measure(options, item.view, draw)
      const witness = readWitness(renderer, target)
      return {
        scene: name, view: item.view, profile: p.name,
        settings: params.map(p => ({ quality: { ...p.quality }, shadowStrength: p.lighting.shadowStrength })),
        gpuMs: summarizeGpuMs(samples), samples, witness,
        preview: preview ? readPreview(renderer, target) : null
      }
    }
    async function control(options: BenchmarkOptions) {
      const samples = await measure(options, 'close', () => pass.depthCopy.render(renderer, target, null))
      return { scene: name, gpuMs: summarizeGpuMs(samples), samples }
    }
    return { description, run, control, dispose: disposeAll }
  } catch (error) { disposeAll(); throw error }
}

function readWitness(renderer: WebGLRenderer, target: WebGLRenderTarget) {
  const tile = new Uint16Array(8 * 8 * 4)
  let signal = 0, peak = 0
  for (const y of [0.2, 0.5, 0.8]) for (const x of [0.2, 0.5, 0.8]) {
    renderer.readRenderTargetPixels(target, Math.floor(target.width * x), Math.floor(target.height * y), 8, 8, tile)
    for (let i = 0; i < tile.length; i++) if (i % 4 !== 3) {
      const value = DataUtils.fromHalfFloat(tile[i])
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid HDR nebula pixels')
      signal += value; peak = Math.max(peak, value)
    }
  }
  if (signal < 1e-6) throw new Error('Empty nebula output; refusing to report a fake speedup')
  return { rgbSum: signal, peak }
}

/** Readback and display conversion happen AFTER all queries; previews are diagnostic. */
function readPreview(renderer: WebGLRenderer, target: WebGLRenderTarget): string {
  const pixels = new Uint16Array(target.width * target.height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
  const canvas = document.createElement('canvas')
  canvas.width = 480; canvas.height = 270
  const context = canvas.getContext('2d')!
  const image = context.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const source = ((target.height - 1 - Math.floor(y * target.height / canvas.height)) * target.width + Math.floor(x * target.width / canvas.width)) * 4
    const dest = (y * canvas.width + x) * 4
    for (let c = 0; c < 3; c++) {
      const linear = DataUtils.fromHalfFloat(pixels[source + c]), mapped = linear / (1 + linear)
      image.data[dest + c] = Math.round(255 * (mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055))
    }
    image.data[dest + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}
