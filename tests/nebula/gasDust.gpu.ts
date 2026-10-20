import {
  Color, Data3DTexture, DataUtils, FloatType, HalfFloatType, PerspectiveCamera, RGFormat,
  Scene, type Texture, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams, type DeepPartial, type NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'

const SIZE = 64

function capture(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): Float32Array {
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: HalfFloatType })
  try {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const half = new Uint16Array(SIZE * SIZE * 4)
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, half)
    if (renderer.getContext().getError()) throw new Error('Gas/dust: WebGL capture error')
    const pixels = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
    if (pixels.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Gas/dust: invalid HDR output')
    return pixels
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
  }
}

function disposeVolume(volume: NebulaVolume): void {
  volume.dispose()
  volume.geometry.dispose()
  volume.material.dispose()
}

/** Exact homogeneous-medium solutions, including the zero-extinction emission limit. */
export function checkNebulaGasDustOptics(): Record<string, number[]> {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.z = 3
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const scene = new Scene()
  const texture = new Data3DTexture(Float32Array.from({ length: 16 }, (_, i) => i % 2 ? 0.7 : 0.4), 2, 2, 2)
  texture.format = RGFormat
  texture.type = FloatType
  texture.needsUpdate = true
  const slope = Math.tan(25 * Math.PI / 180) / SIZE
  const pathLength = 2 * Math.sqrt(1 + 2 * slope * slope)
  const cosine = 2 / pathLength
  const background = new Color().setRGB(0.125, 0.25, 0.5)
  const cases: { name: string; gas: number; dust: number; absorption: number; lit?: boolean; background?: boolean }[] = [
    { name: 'mixed', gas: 1, dust: 0.8, absorption: 0.5 },
    { name: 'gas only', gas: 1, dust: 0, absorption: 1 },
    { name: 'dust only', gas: 0, dust: 0.8, absorption: 1 },
    { name: 'dust against background', gas: 0, dust: 0.8, absorption: 1, background: true },
    { name: 'star lit dust', gas: 0, dust: 0.8, absorption: 1, lit: true },
    { name: 'star lit gas', gas: 1, dust: 0, absorption: 1, lit: true },
    { name: 'pure emission', gas: 1, dust: 0, absorption: 0 },
    { name: 'pure emission against background', gas: 1, dust: 0, absorption: 0, background: true },
    { name: 'thin emission', gas: 1, dust: 0, absorption: 1e-6 },
    { name: 'empty', gas: 0, dust: 0, absorption: 0, background: true }
  ]
  const measured: Record<string, number[]> = {}
  try {
    for (const entry of cases) {
      const params: DeepPartial<NebulaParams> = {
        density: entry.gas,
        gas: { absorption: entry.absorption },
        palette: {
          stops: [0, 0.3, 0.7, 1].map(t => ({ t, color: new Color(1, 1, 1) })),
          secondary: new Color(1, 1, 1), emissiveIntensity: entry.gas ? 1 : 100
        },
        dust: { strength: entry.dust, color: new Color(0.2, 0.4, 0.8) },
        lighting: {
          ambient: entry.gas ? 1 : 100, scatterStrength: 0.75,
          starPosition: entry.lit ? new Vector3(0, 0, 1e6) : null,
          color: new Color(0.8, 0.3, 0.1)
        }
      }
      const volume = new NebulaVolume(mergeNebulaParams(params))
      volume.material.setBakedDensityTexture(texture)
      scene.add(volume)
      renderer.setClearColor(entry.background ? background : 0, entry.background ? 1 : 0)
      const sigma = 0.4 * entry.gas * entry.absorption + 0.7 * entry.dust
      const transmission = Math.exp(-sigma * pathLength)
      const weight = sigma ? -Math.expm1(-sigma * pathLength) / sigma : pathLength
      const source = [0.8, 0.3, 0.1].map((light, channel) =>
        0.4 * entry.gas + (entry.lit ? 0.75 * cosine * light * (0.4 * entry.gas + 0.7 * entry.dust * [0.2, 0.4, 0.8][channel]) : 0))
      const expected = source.map((j, channel) => j * weight + (entry.background ? background.toArray()[channel] * transmission : 0))
      expected.push(entry.background ? 1 : 1 - transmission)
      try {
        for (const steps of [8, 32, 128]) {
          volume.material.uniforms.uMaxSteps.value = steps
          const pixels = capture(renderer, scene, camera)
          const center = Array.from(pixels.slice(((SIZE / 2) * SIZE + SIZE / 2) * 4, ((SIZE / 2) * SIZE + SIZE / 2) * 4 + 4))
          measured[`${entry.name}/${steps}`] = center
          if (center.some((value, channel) => Math.abs(value - expected[channel]) > 0.0015)) {
            throw new Error(`Gas/dust ${entry.name}/${steps}: expected ${expected}, got ${center}`)
          }
        }
      } finally {
        scene.remove(volume)
        disposeVolume(volume)
      }
    }
    return measured
  } finally {
    texture.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

function relativeError(reference: Float32Array, actual: Float32Array): number {
  let delta = 0, signal = 0
  for (let i = 0; i < reference.length; i++) {
    delta += Math.abs(reference[i] - actual[i])
    signal += Math.abs(reference[i])
  }
  return delta / Math.max(signal, 1e-8)
}

/** Independence of both spatial channels, plus live/RG8 equivalence for each. */
export function checkNebulaGasDustFields(): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.set(0.2, 0.3, 3)
  camera.lookAt(0, 0, 0)
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const baker = new NebulaDensityBaker(renderer, 128)
  const coarse = new NebulaDensityBaker(renderer, 64)
  const base = mergeNebulaParams({
    seed: 42, noise: { octaves: 3, worleyStrength: 0, boundaryWarp: 0.3 },
    dust: { seed: 19, frequency: 1.7, contrast: 1.4 },
    palette: { emissiveIntensity: 0 }, quality: { maxSteps: 64 }
  })
  const reseeded = mergeNebulaParams({ dust: { seed: 67 } }, base)
  const restructured = mergeNebulaParams({ dust: { frequency: 3, contrast: 2, threshold: 0.7 } }, base)
  const changedGas = mergeNebulaParams({ noise: { frequency: 3.1, contrast: 2.5 } }, base)
  const disabledDust = mergeNebulaParams({ dust: { threshold: 1 } }, base)
  const render = (params: NebulaParams, channel: 'gas' | 'dust', texture: Texture | null = null): Float32Array => {
    const volume = new NebulaVolume(mergeNebulaParams({ density: channel === 'gas' ? 1 : 0, dust: { strength: channel === 'dust' ? 1 : 0 } }, params))
    volume.material.setBakedDensityTexture(texture)
    scene.add(volume)
    try { return capture(renderer, scene, camera) }
    finally { scene.remove(volume); disposeVolume(volume) }
  }
  try {
    const gas = render(base, 'gas'), dust = render(base, 'dust')
    if (gas.reduce((a, b) => a + b, 0) < 1 || dust.reduce((a, b) => a + b, 0) < 1) throw new Error('Empty gas/dust field probe')
    const gasIndependence = Math.max(...[reseeded, restructured, disabledDust].map(params => relativeError(gas, render(params, 'gas'))))
    const dustIndependence = relativeError(dust, render(changedGas, 'dust'))
    const dustSeedDifference = relativeError(dust, render(reseeded, 'dust'))
    const dustStructureDifference = relativeError(dust, render(restructured, 'dust'))
    const disabledSignal = render(disabledDust, 'dust').reduce((a, b) => a + b, 0)
    const dustCoarseError = relativeError(render(restructured, 'dust'), render(restructured, 'dust', coarse.bake(restructured)))
    let gasBakeError = 0, dustBakeError = 0
    const bakeErrors: Record<string, number> = {}
    for (const params of [base, reseeded, restructured, disabledDust]) {
      const texture = baker.bake(params)
      gasBakeError = Math.max(gasBakeError, relativeError(render(params, 'gas'), render(params, 'gas', texture)))
      const dustError = relativeError(render(params, 'dust'), render(params, 'dust', texture))
      bakeErrors[`dust:${params.dust.seed}/${params.dust.frequency}/${params.dust.threshold}`] = dustError
      dustBakeError = Math.max(dustBakeError, dustError)
    }
    const result = { gasIndependence, dustIndependence, dustSeedDifference, dustStructureDifference, disabledSignal, gasBakeError, dustBakeError, dustCoarseError, ...bakeErrors }
    // Ordinary fields stay within 1%. Thin, thresholded lanes are a deliberate
    // interpolation stress case: allow 5%, but require convergence from 64³.
    if (gasIndependence !== 0 || dustIndependence !== 0 || disabledSignal !== 0 || dustSeedDifference < 0.02 || dustStructureDifference < 0.02 || gasBakeError > 0.01 || bakeErrors['dust:19/1.7/0.55'] > 0.01 || bakeErrors['dust:67/1.7/0.55'] > 0.01 || dustBakeError > 0.05 || dustBakeError > dustCoarseError * 0.6) {
      throw new Error(`Gas/dust field mismatch: ${JSON.stringify(result)}`)
    }
    return result
  } finally {
    baker.dispose()
    coarse.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
