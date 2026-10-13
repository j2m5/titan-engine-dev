import {
  DataUtils, HalfFloatType, PerspectiveCamera, Scene, Uniform,
  WebGLRenderer, WebGLRenderTarget
} from 'three'
import type { Actor } from '@/core/models/Actor'
import { Star } from '@/core/renderables/Star'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { STAR_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'

type Rgb = [number, number, number]

interface Photometry {
  rgb: Rgb
  coverage: number
}

interface LodPhotometrySample {
  temperature: number
  gain: number
  height: number
  pixelRatio: number
  fov: number
  offset: [number, number]
  rgbRatio: Rgb
  coverageRatio: number
}

/**
 * GPU-регрессия потери яркости на AA-кромке импостора.
 * await import('/tests/star/lodPhotometry.gpu.ts').then(m => m.checkStarLodPhotometry())
 *
 * Сфера — независимый эталон покрытия и интегральной энергии. Проверяем
 * реальные материалы в линейном half-float таргете с MSAA, как у композера.
 * Сравнение альфа-площади дополнительно ловит «исправление» одним усилением
 * RGB: оно маскирует потерю энергии, но не возвращает размер диска.
 */
export function checkStarLodPhotometry(): {
  samples: number
  maxRgbError: number
  maxCoverageError: number
  results: LodPhotometrySample[]
} {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setClearColor(0, 0)
  const samples = Math.min(8, renderer.capabilities.maxSamples)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.000001, 1e9)
  const shaderErrors: string[] = []
  const results: LodPhotometrySample[] = []
  const failures: string[] = []
  let maxRgbError = 0, maxCoverageError = 0

  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderErrors.push(
      gl.getProgramInfoLog(program) ?? '',
      gl.getShaderInfoLog(vertex) ?? '',
      gl.getShaderInfoLog(fragment) ?? ''
    )
  }

  try {
    for (const [height, pixelRatio, fov] of [[128, 1, 50], [256, 1, 80], [128, 2, 50]]) {
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(height, height)
      const bufferSize = renderer.domElement.height
      const target = new WebGLRenderTarget(bufferSize, bufferSize, { type: HalfFloatType, samples })
      const pixels = new Uint16Array(bufferSize * bufferSize * 4)
      camera.fov = fov
      camera.updateProjectionMatrix()

      const measure = (): Photometry => {
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        // Переключение таргета разрешает MSAA до чтения пикселей.
        renderer.setRenderTarget(null)
        renderer.readRenderTargetPixels(target, 0, 0, bufferSize, bufferSize, pixels)
        const glError = renderer.getContext().getError()
        if (shaderErrors.length || glError) {
          throw new Error(`Star LOD: shader/WebGL error ${glError}: ${shaderErrors.join('\n')}`)
        }
        const rgb: Rgb = [0, 0, 0]
        let coverage = 0
        for (let i = 0; i < pixels.length; i += 4) {
          for (let c = 0; c < 4; c++) {
            const value = DataUtils.fromHalfFloat(pixels[i + c])
            if (!Number.isFinite(value) || value < 0) throw new Error(`Star LOD: invalid channel ${value}`)
            if (c < 3) rgb[c] += value
            else coverage += value
          }
        }
        if (coverage < 1 || rgb.some(value => value < 1)) throw new Error('Star LOD: empty render')
        return { rgb, coverage }
      }

      try {
        for (const [temperature, radiusKm] of [[3354, 271000], [5778, 696000], [9940, 1192248]]) {
          const actor = {
            getAttribute: (_key: string, fallback?: unknown): unknown => fallback,
            physicalObject: {
              getAttribute: (key: string, fallback?: unknown): unknown =>
                key === 'radius' ? radiusKm : key === 'temperature' ? temperature : fallback
            }
          } as unknown as Actor
          const glowGain = new Uniform(1)
          const sphere = new Star(actor, glowGain)
          const impostor = new FakeStar(actor, renderer, glowGain)
          scene.add(sphere, impostor)
          const radius = toThreeJSUnits(radiusKm)
          const unitsPerPixel = 2 * radius / STAR_IMPOSTOR_PIXELS
          // Геометрическая проекция диаметра, независимо от реализации LOD.
          const distance = radius * bufferSize / (STAR_IMPOSTOR_PIXELS * Math.tan(fov * Math.PI / 360))
          camera.position.set(0, 0, distance)
          camera.lookAt(0, 0, 0)
          camera.updateMatrixWorld()
          const ctx = { camera, elapsed: 123, delta: 0, epoch: 0 }
          sphere.updateObject(ctx)

          try {
            for (const gain of [1, 3]) {
              glowGain.value = gain
              for (const x of [0, 0.25, 0.5]) for (const y of [0, 0.25, 0.5]) {
                sphere.position.set(x * unitsPerPixel, y * unitsPerPixel, 0)
                impostor.position.copy(sphere.position)
                impostor.updateObject(ctx)
                impostor.updateView(camera)
                sphere.visible = true
                impostor.visible = false
                const body = measure()
                sphere.visible = false
                impostor.visible = true
                const far = measure()
                const rgbRatio = far.rgb.map((v, c) => v / body.rgb[c]) as Rgb
                const coverageRatio = far.coverage / body.coverage
                const rgbError = Math.max(...rgbRatio.map(v => Math.abs(v - 1)))
                const coverageError = Math.abs(coverageRatio - 1)
                maxRgbError = Math.max(maxRgbError, rgbError)
                maxCoverageError = Math.max(maxCoverageError, coverageError)
                const result = { temperature, gain, height, pixelRatio, fov, offset: [x, y] as [number, number], rgbRatio, coverageRatio }
                results.push(result)
                if (rgbError > 0.05 || coverageError > 0.05) failures.push(JSON.stringify(result))
              }
            }
          } finally {
            scene.remove(sphere, impostor)
            sphere.geometry.dispose()
            sphere.material.dispose()
            impostor.geometry.dispose()
            impostor.material.dispose()
          }
        }
      } finally {
        renderer.setRenderTarget(null)
        target.dispose()
      }
    }

    if (failures.length) {
      throw new Error(`Star LOD: ${failures.length}/${results.length} cases exceed 5%: RGB ${maxRgbError}, coverage ${maxCoverageError}\n${failures.slice(0, 3).join('\n')}`)
    }
    return { samples, maxRgbError, maxCoverageError, results }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
