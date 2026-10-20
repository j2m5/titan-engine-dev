import {
  BasicDepthPacking, Color, Data3DTexture, DataTexture, DataUtils, DepthTexture, FloatType, HalfFloatType, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, RedFormat, RGBAFormat, RGFormat, Scene, SphereGeometry, UnsignedIntType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams, type DeepPartial, type NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { DepthVolumeResolutionRenderer } from '@/core/graphic/passes/DepthVolumeResolutionRenderer'
import { DepthVolumePass, drawDepthVolumes } from '@/core/graphic/passes/DepthVolumePass'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'

function read(renderer: WebGLRenderer, target: WebGLRenderTarget): Float32Array {
  const half = new Uint16Array(target.width * target.height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, half)
  if (renderer.getContext().getError()) throw new Error('Reduced nebula WebGL error')
  const pixels = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
  if (pixels.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid reduced nebula HDR pixels')
  return pixels
}

function relativeError(a: Float32Array, b: Float32Array): number {
  let error = 0, signal = 0
  for (let i = 0; i < a.length; i++) { error += Math.abs(a[i] - b[i]); signal += Math.abs(a[i]) }
  return error / Math.max(signal, 1e-8)
}

/** Exercises actual low-render/reconstruction draws, including thin depth occluders. */
export function checkNebulaResolution(): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.autoClear = false
  const scaled = new DepthVolumeResolutionRenderer()
  const camera = new PerspectiveCamera(50, 4 / 3, 0.01, 100)
  camera.position.set(0.1, 0.05, 0.2)
  camera.updateMatrixWorld()
  const field = new Data3DTexture(Float32Array.from({ length: 16 }, (_, i) => i % 2 ? 0.7 : 0.4), 2, 2, 2)
  field.format = RGFormat
  field.type = FloatType
  field.needsUpdate = true
  const impostor = new DataTexture(new Float32Array([0.2, 0.1, 0.4, 0.35]), 1, 1, RGBAFormat, FloatType)
  impostor.needsUpdate = true
  const frame = new Object3D()
  frame.scale.setScalar(2)
  const background = new Color(0.08, 0.12, 0.2)
  const result: Record<string, number> = {}
  const base: DeepPartial<NebulaParams> = {
    density: 1.25, gas: { absorption: 0.5 }, dust: { strength: 0.6 },
    palette: { stops: [0, 0.3, 0.7, 1].map(t => ({ t, color: new Color(0.7, 1.4, 2) })), secondary: new Color(0.7, 1.4, 2), emissiveIntensity: 1.4 },
    lighting: { scatterStrength: 0 }, quality: { maxSteps: 32 }
  }
  try {
    for (const [width, height] of [[96, 72], [95, 67]]) {
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      const resolution = new Vector2(width, height)
      const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, depthBuffer: false })
      const depths = new Float32Array(width * height).fill(1)
      const depth = new DataTexture(depths, width, height, RedFormat, FloatType)
      depth.needsUpdate = true
      // Keep shader programs alive across the fixture's renders. Disposing every
      // temporary material immediately would recompile the shader for each image.
      const retained: NebulaVolume[] = []
      const render = (scales: number[], options: { blend?: number; emission?: boolean; witness?: boolean; empty?: boolean } = {}): Float32Array => {
        const volumes = scales.map((resolutionScale, index) => {
          const params = mergeNebulaParams({ ...base,
            ...(options.emission ? { gas: { absorption: 0 }, dust: { strength: 0 } } : {}),
            ...(options.empty ? { density: 0, dust: { strength: 0 } } : {}),
            lighting: { scatterStrength: 0, ambient: index === 0 ? 1 : 0.5 },
            quality: { maxSteps: 32, resolutionScale }
          })
          const volume = new NebulaVolume(params)
          volume.material.setBakedDensityTexture(field)
          volume.setImpostor(impostor, frame)
          volume.material.uniforms.uLodBlend.value = options.blend ?? 1
          volume.material.uniforms.uOpacityScale.value = options.witness ? 0.4 : 1
          volume.updateMatrixWorld()
          retained.push(volume)
          return volume
        })
        renderer.setRenderTarget(target)
        renderer.setClearColor(options.emission ? 0 : background, options.emission ? 0 : 1)
        renderer.clear(true, false, false)
        const draw = renderer.render.bind(renderer)
        let witness: Float32Array | null = null
        renderer.render = (object, view) => {
          draw(object, view)
          if (volumes.includes(object as NebulaVolume) && renderer.getRenderTarget() !== target) {
            const low = renderer.getRenderTarget()!
            if (low.texture === (object as NebulaVolume).material.uniforms.uLowResolutionMap.value) throw new Error('Attached reconstruction sampler')
            if (options.witness) {
              // A known premultiplied image proves the resolve actually samples
              // the reduced image and composites it once, instead of re-marching.
              renderer.setClearColor(new Color(2, 0.75, 0.2), 0.4)
              renderer.clear(true, false, false)
              witness = read(renderer, low)
            }
          }
        }
        try {
          drawDepthVolumes(renderer, target, camera, volumes, depth, resolution, scaled)
          const pixels = read(renderer, target)
          if (options.witness) {
            if (!witness) throw new Error('Reduced viewport was never rendered')
            const sample = witness as Float32Array
            const expected = background.toArray().map((value, channel) => sample[channel] + value * (1 - sample[3]))
            expected.push(1)
            let error = 0
            for (let i = 0; i < pixels.length; i++) error = Math.max(error, Math.abs(pixels[i] - expected[i % 4]))
            result[`resolve witness/${width}`] = error
            if (error > 0.003) throw new Error(`Reduced image not reconstructed: error=${error}`)
          }
          return pixels
        } finally {
          renderer.render = draw
        }
      }
      try {
        render([0.5], { witness: true })
        for (const blend of [0, 0.5, 1]) {
          const reference = render([1], { blend })
          for (const scale of [0.5, 0.25]) {
            const actual = render([scale], { blend })
            const error = relativeError(reference, actual)
            result[`clear/${width}/${blend}/${scale}`] = error
            if (error > 0.004) throw new Error(`Reduced image changes HDR/opacity: ${error}`)
            if (relativeError(actual, render([scale], { blend })) !== 0) throw new Error('Reduced frames are not deterministic')
          }
        }
        const lineX = Math.floor(width / 3)
        const near = Math.log2(1.15) / Math.log2(camera.far + 1)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (x === lineX || (x >= width / 2 && y >= height / 2)) depths[y * width + x] = near
        }
        depth.needsUpdate = true
        const reference = render([1])
        for (const scale of [0.5, 0.25]) {
          const actual = render([scale])
          let edgeError = 0
          let worst: unknown = null
          // Includes a one-pixel foreground line missed by the reduced depth grid.
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const here = depths[y * width + x]
            const edge = [[x-1,y], [x+1,y], [x,y-1], [x,y+1]].some(([nx, ny]) =>
              nx >= 0 && nx < width && ny >= 0 && ny < height && depths[ny * width + nx] !== here)
            if (!edge) continue
            // Ordinary image-border interpolation is covered by the full-frame
            // error; only the foreground itself needs an exact cut there.
            if (here === 1 && (x < 4 || y < 4 || x >= width - 4 || y >= height - 4)) continue
            const index = (y * width + x) * 4
            for (let c = 0; c < 4; c++) {
              const error = Math.abs(actual[index + c] - reference[index + c])
              if (error > edgeError) {
                edgeError = error
                worst = { x, y, depth: depths[y * width + x], expected: Array.from(reference.slice(index, index + 4)), actual: Array.from(actual.slice(index, index + 4)) }
              }
            }
          }
          result[`edge/${width}/${scale}`] = edgeError
          if (edgeError > 0.003) throw new Error(`Depth-edge mismatch: ${JSON.stringify({ width, height, scale, edgeError, worst })}`)
          const imageError = relativeError(reference, actual)
          result[`occluded/${width}/${scale}`] = imageError
          if (imageError > 0.004) throw new Error(`Occluded reduced image mismatch: ${imageError}`)
        }
        const emission = render([0.5], { emission: true })
        if (emission.some((value, i) => i % 4 === 3 && value !== 0) || Math.max(...emission) < 1) throw new Error('Transparent HDR emission was lost')
        const mixedError = relativeError(render([1, 1]), render([0.25, 0.5]))
        result[`mixed/${width}`] = mixedError
        if (mixedError > 0.004) throw new Error(`Shared reduced target leaks between volumes: ${mixedError}`)
        const empty = render([0.5], { empty: true })
        const expected = [...background.toArray(), 1]
        if (empty.some((value, i) => Math.abs(value - expected[i % 4]) > 0.0002)) throw new Error('Reduced target was not cleared')
      } finally {
        for (const volume of retained) { volume.dispose(); volume.geometry.dispose(); volume.material.dispose() }
        target.dispose()
        depth.dispose()
      }
    }
    return result
  } finally {
    renderer.setRenderTarget(null)
    scaled.dispose()
    impostor.dispose()
    field.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

/** Production depth-copy pass, actual planet occlusion, MSAA and procedural fallback. */
export function checkNebulaResolutionFields(): Record<string, number> {
  const size = 80, renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.autoClear = false
  renderer.setSize(size, size)
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.z = 3
  const scene = new Scene()
  const planet = new Mesh(new SphereGeometry(0.4, 48, 32), new MeshBasicMaterial({ color: new Color(0.3, 0.25, 0.1) }))
  planet.position.z = 0.85
  scene.add(planet)
  const base = mergeNebulaParams({
    seed: 42, density: 3, gas: { absorption: 0.5 }, axisRatios: new Vector3(1, 1, 1),
    structure: { direction: new Vector3(0.5, 1, 0.1), stretch: 2 },
    noise: { octaves: 3, worleyStrength: 0, boundaryWarp: 0.2 },
    dust: { seed: 19, strength: 1.2, threshold: 0.3, color: new Color(0.2, 0.3, 0.4) },
    lighting: { starPosition: new Vector3(0.3, 0.4, -2), anisotropy: 0.35, shadowStrength: 1 },
    quality: { maxSteps: 48, lightSteps: 4 }
  })
  const baker = new NebulaDensityBaker(renderer, 64)
  const result: Record<string, number> = {}
  try {
    const field = baker.bake(base)
    for (const { baked, samples } of [{ baked: true, samples: 0 }, { baked: true, samples: 4 }, { baked: false, samples: 0 }]) {
      const registry = new DepthVolumeRegistry()
      const params = mergeNebulaParams({ quality: { bake3DTexture: baked } }, base)
      const volume = new NebulaVolume(params, registry)
      volume.material.setBakedDensityTexture(baked ? field : null)
      scene.add(volume)
      const depth = new DepthTexture(size, size, UnsignedIntType)
      const target = new WebGLRenderTarget(size, size, { type: HalfFloatType, depthTexture: depth, samples })
      const pass = new DepthVolumePass(camera, registry)
      pass.initialize(renderer, true, HalfFloatType)
      pass.setSize(size, size)
      pass.setDepthTexture(depth, BasicDepthPacking)
      const render = (scale: number): Float32Array => {
        params.quality.resolutionScale = scale
        renderer.setRenderTarget(target)
        renderer.setClearColor(new Color(0.003, 0.004, 0.006), 1)
        renderer.clear()
        renderer.render(scene, camera)
        pass.render(renderer, target, null)
        return read(renderer, target)
      }
      try {
        const reference = render(1)
        for (const scale of [0.5, 0.25]) {
          const actual = render(scale)
          let signal = 0, delta = 0, planetError = 0
          for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) {
            signal += reference[i]
            delta += Math.abs(reference[i] - actual[i])
          }
          for (let y = size / 2 - 7; y < size / 2 + 7; y++) for (let x = size / 2 - 7; x < size / 2 + 7; x++) {
            for (let c = 0; c < 4; c++) {
              const i = (y * size + x) * 4 + c
              planetError = Math.max(planetError, Math.abs(reference[i] - actual[i]))
            }
          }
          const error = delta / Math.max(signal, 1e-8)
          result[`field/${baked}/${samples}/${scale}`] = error
          result[`planet/${baked}/${samples}/${scale}`] = planetError
          if (error > (scale === 0.5 ? 0.04 : 0.09) || planetError > 0.002) {
            throw new Error(`Reduced field mismatch: ${JSON.stringify({ baked, samples, scale, error, planetError })}`)
          }
        }
      } finally {
        renderer.setRenderTarget(null)
        scene.remove(volume)
        volume.dispose()
        volume.geometry.dispose()
        volume.material.dispose()
        pass.dispose()
        target.dispose()
        depth.dispose()
      }
    }
    return result
  } finally {
    baker.dispose()
    planet.geometry.dispose()
    planet.material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
