import { DataUtils, HalfFloatType, PerspectiveCamera, Scene, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { Actors, RenderingObjects } from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import { three } from '@/config/three'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'
import { nebulaParamsFromData, type NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'

const SIZE = 64
const MAX_RELATIVE_ERROR = 0.002

interface CaptureResult {
  near: 'production' | 'finite'
  view: string
  relativeError: number
  referenceSignal: number
  missingPixels: number
}

/**
 * The real Crab shader/proxy must keep its pixels through the agreed 30% retreat.
 * A 1 AU near plane exposes far clipping that the production near/far ratio can
 * hide when the float32 projection coefficient rounds to -1. Both cameras stay
 * far outside the density field; only the raster clipping precision changes.
 */
export function checkCrabFarPlane(): { farAu: number; results: CaptureResult[] } {
  const scenario = Scenarios.find((item) => item.id === 14)!
  const actor = Actors.find((item) => item.name === 'Crab shell')!
  const data = RenderingObjects.find((item) => item.actorId === actor.id)!.data as NebulaRenderingData
  const params = nebulaParamsFromData(data)
  const volume = new NebulaVolume(params)
  volume.scale.setScalar(params.size)
  const scene = new Scene()
  scene.add(volume)
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0, 0)
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: HalfFloatType })
  const camera = new PerspectiveCamera(three.camera.fov, 1, three.camera.near, three.camera.far)
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const start = new Vector3(...scenario.defaultCameraPosition)
  const retreatDistance = start.length() * 1.3
  const views = [{ name: 'start', position: start }]
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x === 0 && y === 0 && z === 0) continue
    views.push({ name: `${x},${y},${z}`, position: new Vector3(x, y, z).setLength(retreatDistance) })
  }
  const results: CaptureResult[] = []

  const capture = (far: number): Float32Array => {
    camera.far = far
    camera.updateProjectionMatrix()
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const half = new Uint16Array(SIZE * SIZE * 4)
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, half)
    if (renderer.getContext().getError()) throw new Error('Crab far plane: WebGL error')
    const pixels = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
    if (pixels.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Crab far plane: invalid HDR pixels')
    return pixels
  }

  try {
    for (const near of ['production', 'finite'] as const) {
      camera.near = near === 'production' ? three.camera.near : fromAstronomicalUnits(1)
      for (const view of views) {
        camera.position.copy(view.position)
        camera.lookAt(0, 0, 0)
        const reference = capture(fromAstronomicalUnits(20_000))
        const actual = capture(three.camera.far)
        let difference = 0, referenceSignal = 0, missingPixels = 0
        for (let i = 0; i < reference.length; i++) {
          difference += Math.abs(reference[i] - actual[i])
          referenceSignal += reference[i]
          if (i % 4 === 3 && reference[i] > 0.01 && actual[i] === 0) missingPixels++
        }
        if (referenceSignal < 1) throw new Error(`Crab far plane: empty reference at ${near}/${view.name}`)
        results.push({ near, view: view.name, relativeError: difference / referenceSignal, referenceSignal, missingPixels })
      }
    }
    const failures = results.filter(result => result.relativeError > MAX_RELATIVE_ERROR || result.missingPixels > 0)
    if (failures.length) {
      throw Object.assign(new Error(`Crab far plane clips the shell: ${JSON.stringify(failures)}`), { results })
    }
    return { farAu: three.camera.far / fromAstronomicalUnits(1), results }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    volume.removeFromParent()
    volume.dispose()
    volume.geometry.dispose()
    volume.material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
