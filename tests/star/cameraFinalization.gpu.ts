import '@/core/framework/TitanThree'
import {
  DataUtils, Group, HalfFloatType, PerspectiveCamera, Scene,
  Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import type { Actor } from '@/core/models/Actor'
import { Star } from '@/core/renderables/Star'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { toThreeJSUnits } from '@/core/helpers/scaling'

interface CameraSample {
  scenario: string
  pixels: number
  pixelRatio: number
  rgbError: number
  coverageError: number
  maxPixelError: number
  imageError: number
  referenceVertices: number
  actualVertices: number
}

/**
 * MS-03: кадр с поздним переносом камеры совпадает с кадром, где камера
 * сразу стоит на окончательном месте. Реальные LOD, отсечение и HDR/MSAA.
 * Порядок вызовов самим Engine отдельно защищён в EngineFrame.spec.ts.
 * await import('/tests/star/cameraFinalization.gpu.ts').then(m => m.checkStarCameraFinalization())
 */
export function checkStarCameraFinalization(): { results: CameraSample[] } {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setClearColor(0, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.000001, 1e9)
  const shaderErrors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderErrors.push(
      gl.getProgramInfoLog(program) ?? '',
      gl.getShaderInfoLog(vertex) ?? '',
      gl.getShaderInfoLog(fragment) ?? ''
    )
  }
  const results: CameraSample[] = []
  const failures: CameraSample[] = []
  const radiusKm = 696000
  const actor = {
    getAttribute: (_key: string, fallback?: unknown): unknown => fallback,
    physicalObject: {
      getAttribute: (key: string, fallback?: unknown): unknown =>
        key === 'radius' ? radiusKm : key === 'temperature' ? 5778 : fallback
    }
  } as unknown as Actor
  const ctx = { camera, elapsed: 123, delta: 0, epoch: 0 }
  const update = (): void => scene.traverse(object => object.updateObject(ctx))
  const updateView = (): void => scene.traverse(object => object.updateView?.(camera))

  try {
    for (const pixelRatio of [1, 2]) for (const pixels of [5, 24, 80]) {
      for (const scenario of ['follow', 'collision', 'fov-resize', 'frustum-edge']) {
        // На краю проверяем именно импостор; крупная сфера проверена в остальных сценариях.
        if (scenario === 'frustum-edge' && pixels !== 5) continue
        renderer.setPixelRatio(pixelRatio)
        renderer.setSize(128, 128)
        const height = renderer.domElement.height
        const fov = scenario === 'fov-resize' ? 80 : 50
        const distance = toThreeJSUnits(radiusKm) * height / (pixels * Math.tan(fov * Math.PI / 360))
        const node = new Group()
        const lod = new StarLod(radiusKm, renderer)
        const disk = new Star(actor, lod.glowGain)
        const impostor = new FakeStar(actor, renderer, lod.glowGain)
        lod.addLevel(disk)
        lod.addLevel(impostor, lod.switchDistance(fov), 0.05)
        node.add(lod)
        scene.add(node)
        const target = new WebGLRenderTarget(height, height, {
          type: HalfFloatType, samples: Math.min(8, renderer.capabilities.maxSamples)
        })
        const finalCamera = new Vector3(0, 0, distance)
        if (scenario === 'follow') {
          node.position.set(distance * 10, distance / 2, 0)
          finalCamera.add(node.position)
        } else if (scenario === 'frustum-edge') {
          // Центр за краем кадра, но часть диска должна оставаться видимой.
          node.position.x = distance * Math.tan(fov * Math.PI / 360) * 1.01
        }
        const finalizeCamera = (): void => {
          camera.position.copy(finalCamera)
          camera.quaternion.identity()
          camera.fov = fov
          camera.updateProjectionMatrix()
          renderer.setSize(128, 128)
        }
        const capture = (): Float32Array => {
          renderer.setRenderTarget(target)
          renderer.render(scene, camera)
          renderer.setRenderTarget(null)
          const half = new Uint16Array(height * height * 4)
          renderer.readRenderTargetPixels(target, 0, 0, height, height, half)
          const error = renderer.getContext().getError()
          if (error || shaderErrors.length) {
            throw new Error(`Star camera: WebGL ${error}: ${shaderErrors.join('\n')}`)
          }
          const values = new Float32Array(half.length)
          for (let i = 0; i < half.length; i++) {
            values[i] = DataUtils.fromHalfFloat(half[i])
            if (!Number.isFinite(values[i]) || values[i] < 0) throw new Error('Star camera: invalid HDR channel')
          }
          return values
        }
        try {
          finalizeCamera()
          update()
          updateView()
          const reference = capture()
          const referenceVertices = disk.geometry.attributes.position.count

          if (scenario === 'follow') camera.position.set(0, 0, distance)
          if (scenario === 'collision') camera.position.z *= 20
          if (scenario === 'fov-resize') {
            camera.fov = 25
            camera.updateProjectionMatrix()
            renderer.setSize(64, 64)
          }
          if (scenario === 'frustum-edge') {
            camera.position.copy(node.position).add(new Vector3(0, 0, distance / 1000))
          }
          update()
          finalizeCamera()
          updateView()
          const actual = capture()
          const expectedTotal = [0, 0, 0, 0]
          const actualTotal = [0, 0, 0, 0]
          let maxPixelError = 0
          let imageDifference = 0
          for (let i = 0; i < reference.length; i++) {
            expectedTotal[i % 4] += reference[i]
            actualTotal[i % 4] += actual[i]
            maxPixelError = Math.max(maxPixelError, Math.abs(actual[i] - reference[i]))
            if (i % 4 !== 3) imageDifference += Math.abs(actual[i] - reference[i])
          }
          if (expectedTotal.some(value => value < 1)) throw new Error(`Star camera: empty reference (${scenario})`)
          const rgbError = Math.max(...expectedTotal.slice(0, 3).map((value, c) => Math.abs(actualTotal[c] / value - 1)))
          const coverageError = Math.abs(actualTotal[3] / expectedTotal[3] - 1)
          const imageError = imageDifference / (expectedTotal[0] + expectedTotal[1] + expectedTotal[2])
          const result = {
            scenario, pixels, pixelRatio, rgbError, coverageError, maxPixelError, imageError,
            referenceVertices, actualVertices: disk.geometry.attributes.position.count
          }
          results.push(result)
          // SphereDetail может сменить сетку при промежуточном FOV: допускаем
          // малое суммарное расхождение грануляции, но не потерю покрытия/энергии.
          if (rgbError > 0.005 || coverageError > 0.005 || imageError > 0.02) failures.push(result)
        } finally {
          scene.remove(node)
          disk.geometry.dispose()
          disk.material.dispose()
          impostor.geometry.dispose()
          impostor.material.dispose()
          target.dispose()
        }
      }
    }
    if (failures.length) throw new Error(`Star camera regression: ${JSON.stringify(failures)}`)
    return { results }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
