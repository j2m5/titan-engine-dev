import {
  DataUtils, HalfFloatType, Mesh, PerspectiveCamera, Scene, ShaderMaterial,
  WebGLRenderer, WebGLRenderTarget
} from 'three'
import type { Actor } from '@/core/models/Actor'
import { Star } from '@/core/renderables/Star'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { unfilteredStarReference } from './granulationFiltering.gpu'

/**
 * Проверяет средний RGB настоящей сферы, включая лимб, на разных размерах
 * и временных срезах. Эталон — полный исходный спектр с четырёхкратным DPR.
 * await import('/tests/star/granulationPhotometry.gpu.ts').then(m => m.checkStarGranulationPhotometry())
 */
export function checkStarGranulationPhotometry(): {
  maxRgbError: number
  results: { temperature: number; diameter: number; elapsed: number; error: number }[]
} {
  const renderer = new WebGLRenderer()
  renderer.setClearColor(0, 0)
  const target = new WebGLRenderTarget(256, 256, { type: HalfFloatType, samples: Math.min(8, renderer.capabilities.maxSamples) })
  const scene = new Scene(), camera = new PerspectiveCamera(50, 1, 0.000001, 1e9)
  const shaderErrors: string[] = []
  const results = []
  let maxRgbError = 0
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderErrors.push(gl.getProgramInfoLog(program) ?? '', gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
  }

  const measure = (pixelRatio: number): number[] => {
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(256, 256)
    const size = 256 * pixelRatio
    target.setSize(size, size)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    const pixels = new Uint16Array(size * size * 4)
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)
    const glError = renderer.getContext().getError()
    if (glError || shaderErrors.length) throw new Error(`Star granulation: WebGL ${glError}, ${shaderErrors.join('\n')}`)
    const sum = [0, 0, 0, 0]
    for (let i = 0; i < pixels.length; i++) {
      const value = DataUtils.fromHalfFloat(pixels[i])
      if (!Number.isFinite(value) || value < 0) throw new Error(`Star granulation: invalid radiance ${value}`)
      sum[i % 4] += value
    }
    if (sum[3] < 1 || sum.slice(0, 3).some(v => v <= 0)) throw new Error('Star granulation: empty render')
    return sum.slice(0, 3).map(v => v / sum[3])
  }

  try {
    for (const [temperature, radiusKm] of [[3354, 271000], [5778, 696000], [8000, 1192248], [9940, 1192248]]) {
      const actor = {
        getAttribute: (_key: string, fallback?: unknown): unknown => fallback,
        physicalObject: {
          getAttribute: (key: string, fallback?: unknown): unknown => key === 'radius' ? radiusKm : key === 'temperature' ? temperature : fallback
        }
      } as unknown as Actor
      const star = new Star(actor)
      const referenceMaterial = new ShaderMaterial({
        uniforms: star.material.uniforms, vertexShader: star.material.vertexShader, fragmentShader: unfilteredStarReference
      })
      const reference = new Mesh(star.geometry, referenceMaterial)
      scene.add(star, reference)
      try {
        for (const diameter of [24, 64, 192]) for (const elapsed of [123, 456, 987]) {
          camera.position.set(0, 0, toThreeJSUnits(radiusKm) * 256 / (diameter * Math.tan(camera.fov * Math.PI / 360)))
          camera.lookAt(0, 0, 0)
          camera.updateMatrixWorld()
          star.updateObject({ camera, elapsed, delta: 0, epoch: 0 })
          reference.geometry = star.geometry
          star.visible = true
          reference.visible = false
          const filtered = measure(1)
          star.visible = false
          reference.visible = true
          const original = measure(4)
          const error = Math.max(...filtered.map((v, c) => Math.abs(v / original[c] - 1)))
          maxRgbError = Math.max(maxRgbError, error)
          results.push({ temperature, diameter, elapsed, error })
        }
      } finally {
        scene.remove(star, reference)
        star.geometry.dispose()
        star.material.dispose()
        referenceMaterial.dispose()
      }
    }
    if (maxRgbError > 0.05) throw Object.assign(new Error(`Star granulation photometry exceeds 5%: ${maxRgbError}`), { results })
    return { maxRgbError, results }
  } finally {
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
