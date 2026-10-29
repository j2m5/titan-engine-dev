import {
  DataTexture, FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry,
  RGBAFormat, Scene, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { DownsampleThresholdMaterial } from '@/core/graphic/effects/lensflare/DownsampleThresholdMaterial'

/** Measure the actual filter's impulse response, independently of its tap formula. */
export function checkDownsampleThreshold() {
  const size = 33, center = (size - 1) / 2
  const renderer = new WebGLRenderer()
  renderer.setSize(size, size)
  const pixels = new Float32Array(size * size * 4)
  const texture = new DataTexture(pixels, size, size, RGBAFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  const material = new DownsampleThresholdMaterial({ inputBuffer: texture, thresholdLevel: 0, thresholdRange: 0.01 })
  material.setSize(size, size)
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const target = new WebGLRenderTarget(size, size, { type: FloatType, depthBuffer: false })
  const renderImpulse = (x: number, y: number) => {
    pixels.fill(0)
    pixels.fill(32, (y * size + x) * 4, (y * size + x) * 4 + 3)
    texture.needsUpdate = true
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const output = new Float32Array(pixels.length)
    renderer.readRenderTargetPixels(target, 0, 0, size, size, output)
    return output
  }
  const reflectionError = (a: Float32Array, b: Float32Array, horizontal: boolean) => {
    let worst = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const other = horizontal ? y * size + size - 1 - x : (size - 1 - y) * size + x
      worst = Math.max(worst, Math.abs(a[(y * size + x) * 4] - b[other * 4]))
    }
    return worst
  }
  try {
    const middle = renderImpulse(center, center)
    let energy = 0, mx = 0, my = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const value = middle[(y * size + x) * 4]
      if (!Number.isFinite(value)) throw new Error('Nonfinite filter response')
      energy += value
      mx += x * value
      my += y * value
    }
    const results = {
      energy, centroid: [mx / energy, my / energy],
      centerX: reflectionError(middle, middle, true),
      centerY: reflectionError(middle, middle, false),
      edgeX: reflectionError(renderImpulse(0, center), renderImpulse(size - 1, center), true),
      edgeY: reflectionError(renderImpulse(center, 0), renderImpulse(center, size - 1), false)
    }
    if (!(energy > 0) || Math.abs(results.centroid[0] - center) > 1e-5 ||
      Math.abs(results.centroid[1] - center) > 1e-5 ||
      Math.max(results.centerX, results.centerY, results.edgeX, results.edgeY) > 1e-5) {
      throw Object.assign(new Error(`Asymmetric downsample: ${JSON.stringify(results)}`), { results })
    }
    return results
  } finally {
    target.dispose()
    geometry.dispose()
    material.dispose()
    texture.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
