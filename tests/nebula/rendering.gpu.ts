import {
  Color, Data3DTexture, DataTexture, DataUtils, FloatType, HalfFloatType, PerspectiveCamera, RedFormat, Scene, Vector2, Vector3,
  WebGL3DRenderTarget, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams, type DeepPartial, type NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'
import { ImpostorBaker } from '@/core/renderables/Nebula/volume/ImpostorBaker'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'
import { Nebula } from '@/core/renderables/Nebula'

const SIZE = 64

function capture(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, requireSignal = true): Float32Array {
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: HalfFloatType })
  try {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const half = new Uint16Array(SIZE * SIZE * 4)
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, half)
    if (renderer.getContext().getError()) throw new Error('Nebula: WebGL error during capture')
    const pixels = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
    if (pixels.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Nebula: invalid HDR channel')
    if (requireSignal && pixels.reduce((sum, value) => sum + value, 0) < 1) throw new Error('Nebula: empty reference image')
    return pixels
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
  }
}

/** Homogeneous media have an analytic integral independent of march subdivisions. */
export function checkNebulaAbsorption(): { expectedAlpha: number; alphas: number[] } {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.z = 3
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const texture = new Data3DTexture(new Float32Array(8).fill(0.5), 2, 2, 2)
  texture.format = RedFormat
  texture.type = FloatType
  texture.needsUpdate = true
  const volume = new NebulaVolume(mergeNebulaParams({ density: 0.8, dust: { strength: 0 } }))
  volume.material.setBakedDensityTexture(texture)
  scene.add(volume)
  const center = ((SIZE / 2) * SIZE + SIZE / 2) * 4 + 3
  const raySlope = Math.tan(25 * Math.PI / 180) / SIZE
  const pathLength = 2 * Math.sqrt(1 + 2 * raySlope * raySlope)
  const expectedAlpha = 1 - Math.exp(-0.5 * 0.8 * pathLength)
  const alphas: number[] = []
  try {
    for (const steps of [8, 32, 128]) {
      volume.material.uniforms.uMaxSteps.value = steps
      alphas.push(capture(renderer, scene, camera)[center])
    }
    volume.material.uniforms.uDensityScale.value = 0
    const empty = capture(renderer, scene, camera, false)
    if (empty.some(value => value !== 0)) throw new Error('Zero-density nebula is not transparent')
    if (alphas.some(alpha => Math.abs(alpha - expectedAlpha) > 0.001)) {
      throw new Error(`Nebula absorption depends on steps: ${JSON.stringify({ expectedAlpha, alphas })}`)
    }
    return { expectedAlpha, alphas }
  } finally {
    disposeVolume(volume)
    texture.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

/** LOD at one camera must be an exact premultiplied mix of the two endpoints. */
export function checkNebulaLodComposition(overrides: DeepPartial<NebulaParams> = {}): { imageError: number; endpointDifference: number } {
  const renderer = new WebGLRenderer()
  // Select the middle of the 150..450 CSS-pixel LOD interval, read a small RT.
  renderer.setSize(1024, 1024)
  renderer.setClearColor(0x153050, 0.3)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.01, 1e12)
  camera.position.z = 1024 / (2 * Math.tan(25 * Math.PI / 180) * 300)
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const nebula = new Nebula(renderer, { ...overrides, size: 1, quality: { bake3DTexture: false, maxSteps: 32 } })
  const volume = nebula.children[0] as NebulaVolume
  const depth = new DataTexture(new Float32Array(SIZE * SIZE).fill(Math.log2(camera.position.z + 0.2) / Math.log2(camera.far + 1)), SIZE, SIZE, RedFormat, FloatType)
  depth.needsUpdate = true
  scene.add(nebula)
  try {
    let imageError = 0
    let endpointDifference = 0
    for (const scenario of ['base', 'roll', 'translated', 'depth']) {
      if (scenario === 'roll') camera.rotateZ(0.7)
      if (scenario === 'translated') {
        const offset = new Vector3(1e10, -1e10, 1e10)
        nebula.position.copy(offset)
        camera.position.add(offset)
      }
      if (scenario === 'depth') volume.bindSceneDepth(depth, new Vector2(SIZE, SIZE), Math.log2(camera.far + 1))
      nebula.params.quality.forceLOD = 'impostor'
      nebula.updateView(camera)
      for (let frame = 0; frame < 100 && nebula.bakeQueue.pendingCount; frame++) nebula.bakeQueue.pumpFrame()
      if (nebula.bakeQueue.pendingCount) throw new Error('Nebula bake failed to finish')
      const far = capture(renderer, scene, camera)
      nebula.params.quality.forceLOD = 'raymarch'
      nebula.updateView(camera)
      const near = capture(renderer, scene, camera)
      endpointDifference = Math.max(endpointDifference, relativeError(near, far))
      nebula.params.quality.forceLOD = 'auto'
      nebula.updateView(camera)
      const mixed = capture(renderer, scene, camera)
      const expected = Float32Array.from(near, (value, index) => (value + far[index]) * 0.5)
      imageError = Math.max(imageError, relativeError(expected, mixed))
    }
    // A depth cut can make both representations almost empty. Require distinct
    // endpoints somewhere in the probe, while checking the mix in every case.
    if (endpointDifference < 0.001) throw new Error('LOD probe did not exercise distinct endpoints')
    if (imageError > 0.002) throw new Error(`Nebula LOD loses brightness/alpha: ${imageError}`)
    return { imageError, endpointDifference }
  } finally {
    nebula.dispose()
    depth.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

/** Backfaces of the enlarged raster proxy must fit the bake camera at diagonal views. */
export function checkNebulaDiagonalBake(): { alpha: number } {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  const volume = new NebulaVolume(mergeNebulaParams({ density: 1 }))
  const texture = new Data3DTexture(new Float32Array(8).fill(0.5), 2, 2, 2)
  texture.format = RedFormat
  texture.type = FloatType
  texture.needsUpdate = true
  volume.material.setBakedDensityTexture(texture)
  const camera = new PerspectiveCamera()
  camera.position.set(3, 3, 3)
  const baker = new ImpostorBaker(renderer, SIZE)
  const render = renderer.render
  let alpha = 0
  renderer.render = (object, bakeCamera) => {
    render.call(renderer, object, bakeCamera)
    const pixel = new Uint16Array(4)
    renderer.readRenderTargetPixels(renderer.getRenderTarget()!, SIZE / 2, SIZE / 2, 1, 1, pixel)
    alpha = DataUtils.fromHalfFloat(pixel[3])
  }
  try {
    baker.bake(volume, camera, new Vector3(), 1)
    if (alpha < 0.7) throw new Error(`Diagonal nebula bake clipped the proxy: alpha=${alpha}`)
    return { alpha }
  } finally {
    renderer.render = render
    baker.dispose()
    texture.dispose()
    disposeVolume(volume)
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

/** Tiled draws must reproduce one-shot baking; an unfinished density uses live noise. */
export function checkNebulaIncrementalBaking(): { fallbackError: number; densityError: number; impostorError: number } {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0, 0)
  const params = mergeNebulaParams({ seed: 42, noise: { octaves: 3, worleyStrength: 0 }, quality: { maxSteps: 24 } })
  const volume = new NebulaVolume(params)
  const live = new NebulaVolume(mergeNebulaParams({ ...params, quality: { ...params.quality, bake3DTexture: false } }))
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.set(0.4, 0.2, 3)
  camera.lookAt(0, 0, 0)
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const density = new NebulaDensityBaker(renderer, 16)
  const incremental = new NebulaDensityBaker(renderer, 16)
  const impostor = new ImpostorBaker(renderer, 256)
  const render = renderer.render
  try {
    scene.add(live)
    const liveImage = capture(renderer, scene, camera)
    scene.remove(live)
    scene.add(volume)
    const fallbackError = relativeError(liveImage, capture(renderer, scene, camera))
    volume.material.setBakedDensityTexture(density.bake(params))
    const bakedImage = capture(renderer, scene, camera)
    incremental.start(params)
    for (let layer = 0; layer < 16; layer++) {
      if (incremental.step() !== (layer === 15)) throw new Error('Density completion published at the wrong slice')
    }
    volume.material.setBakedDensityTexture(incremental.texture)
    const densityError = relativeError(bakedImage, capture(renderer, scene, camera))

    let pixels = new Float32Array()
    renderer.render = (object, bakeCamera) => {
      render.call(renderer, object, bakeCamera)
      const target = renderer.getRenderTarget()!
      const half = new Uint16Array(target.width * target.height * 4)
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, half)
      pixels = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
    }
    const previous = impostor.bake(volume, camera, new Vector3(), 1)
    const reference = pixels
    impostor.begin(volume, camera, new Vector3(), 1)
    // A new frame may update scene transforms while the old bake is incomplete.
    volume.position.x = 50
    volume.updateWorldMatrix(true, false)
    for (let tile = 0; tile < 4; tile++) {
      if (impostor.step() !== (tile === 3)) throw new Error('Impostor completion published at the wrong tile')
      if (tile < 3 && impostor.texture !== previous) throw new Error('Partial impostor was published')
      if (volume.matrixWorld.elements[12] !== 50) throw new Error('Bake did not restore the current world transform')
    }
    const impostorError = relativeError(reference, pixels)
    if (fallbackError > 1e-6 || densityError > 1e-6 || impostorError > 1e-6) {
      throw new Error(`Incremental bake differs: ${JSON.stringify({ fallbackError, densityError, impostorError })}`)
    }
    if (renderer.getContext().getError()) throw new Error('WebGL error during incremental baking')
    return { fallbackError, densityError, impostorError }
  } finally {
    renderer.render = render
    density.dispose()
    incremental.dispose()
    impostor.dispose()
    disposeVolume(volume)
    disposeVolume(live)
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

function relativeError(a: Float32Array, b: Float32Array): number {
  let difference = 0, total = 0
  for (let i = 0; i < a.length; i++) {
    difference += Math.abs(a[i] - b[i])
    total += Math.abs(a[i])
  }
  return difference / Math.max(total, 1e-9)
}

function disposeVolume(volume: NebulaVolume): void {
  volume.removeFromParent()
  volume.dispose()
  volume.geometry.dispose()
  volume.material.dispose()
}

/** Both GPU density paths must respond to seed, and repeat it deterministically. */
export function checkNebulaSeed(): { results: { baked: boolean; repeatError: number; seedDifference: number }[] } {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  camera.position.z = 3
  const results: { baked: boolean; repeatError: number; seedDifference: number }[] = []
  try {
    for (const baked of [false, true]) {
      const images: Float32Array[] = []
      for (const seed of [1337, 1337, 42]) {
        // Isolate density: seeded dust alone must not satisfy this regression.
        const params = mergeNebulaParams({ seed, dust: { strength: 0 }, quality: { bake3DTexture: baked, maxSteps: 32 } })
        const volume = new NebulaVolume(params)
        const baker = baked ? new NebulaDensityBaker(renderer, 32) : null
        try {
          if (baker) volume.material.setBakedDensityTexture(baker.bake(params))
          scene.add(volume)
          images.push(capture(renderer, scene, camera))
        } finally {
          disposeVolume(volume)
          baker?.dispose()
        }
      }
      results.push({ baked, repeatError: relativeError(images[0], images[1]), seedDifference: relativeError(images[0], images[2]) })
    }
    if (results.some(result => result.repeatError > 1e-6 || result.seedDifference < 0.01)) {
      throw new Error(`Nebula seed regression: ${JSON.stringify(results)}`)
    }
    return { results }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

/** A shared world translation must not change the volume's image. */
export function checkNebulaWorldPrecision(): { imageError: number } {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.01, 1e8)
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const volume = new NebulaVolume(mergeNebulaParams({ quality: { bake3DTexture: false, maxSteps: 32 } }))
  volume.scale.setScalar(500)
  scene.add(volume)
  try {
    camera.position.set(250, -100, 1500)
    camera.lookAt(0, 0, 0)
    const reference = capture(renderer, scene, camera)
    const offset = new Vector3(1e12, -1e12, 1e12)
    volume.position.copy(offset)
    camera.position.add(offset)
    const translated = capture(renderer, scene, camera)
    const imageError = relativeError(reference, translated)
    if (imageError > 0.005) throw new Error(`Nebula loses precision after world translation: ${imageError}`)
    return { imageError }
  } finally {
    disposeVolume(volume)
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

/** Bakes must leave the renderer usable, including when the render throws. */
export function checkNebulaBakeState(): { cases: number; failures: string[] } {
  const renderer = new WebGLRenderer({ premultipliedAlpha: false })
  renderer.setSize(SIZE, SIZE)
  const previous = new WebGL3DRenderTarget(8, 8, 8)
  const camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.z = 3
  const params = mergeNebulaParams({ quality: { bake3DTexture: false, maxSteps: 8 } })
  const volume = new NebulaVolume(params)
  const impostor = new ImpostorBaker(renderer, 16)
  const density = new NebulaDensityBaker(renderer, 8)
  const render = renderer.render
  const failures: string[] = []
  let cases = 0
  try {
    for (const kind of ['impostor', 'density']) for (const throws of [false, true]) {
      renderer.setRenderTarget(previous, 3)
      renderer.setClearColor(0x336699, 0.7)
      const clearColor = renderer.getClearColor(new Color()).clone()
      const failure = new Error('injected render failure')
      let caught: unknown
      if (throws) renderer.render = () => { throw failure }
      try {
        if (kind === 'impostor') impostor.bake(volume, camera, new Vector3(), 1)
        else density.bake(params)
      } catch (error) {
        caught = error
      } finally {
        renderer.render = render
      }
      const label = `${kind}, throws=${throws}`
      if (caught !== (throws ? failure : undefined)) failures.push(`${label}: unexpected exception`)
      if (renderer.getRenderTarget() !== previous || renderer.getActiveCubeFace() !== 3) failures.push(`${label}: wrong target/layer`)
      if (renderer.getClearAlpha() !== 0.7 || !renderer.getClearColor(new Color()).equals(clearColor)) failures.push(`${label}: wrong clear state`)
      cases++
    }
    // Premultiplied texture pixels outside the volume must be transparent BLACK,
    // independent of the canvas's premultipliedAlpha and caller's clear colour.
    renderer.setClearColor(0xff0000, 1)
    // Read the baker's actual target while bound, without exposing test-only API.
    renderer.render = (object, bakeCamera) => {
      render.call(renderer, object, bakeCamera)
      const half = new Uint16Array(4)
      renderer.readRenderTargetPixels(renderer.getRenderTarget()!, 0, 0, 1, 1, half)
      if (half.some(value => value !== 0)) failures.push('impostor: coloured transparent background')
    }
    try {
      impostor.bake(volume, camera, new Vector3(), 1)
    } finally {
      renderer.render = render
    }
    if (renderer.getContext().getError()) failures.push('WebGL error')
    if (failures.length) throw new Error(`Nebula bake state: ${JSON.stringify(failures)}`)
    return { cases, failures }
  } finally {
    renderer.render = render
    renderer.setRenderTarget(null)
    impostor.dispose()
    density.dispose()
    disposeVolume(volume)
    previous.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
