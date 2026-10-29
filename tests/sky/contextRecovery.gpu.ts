import { FloatType, PerspectiveCamera, RawShaderMaterial, Scene, WebGLRenderer, WebGLRenderTarget } from 'three'
import { GaiaSky } from '@/core/sky/GaiaSky'
import { createGaiaSkyUniforms, type GaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'
import { gaiaTileByteLength, gaiaTiles, splitGaiaTile, type GaiaTile } from '@/core/sky/gaiaTiles'
import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'

const tails = gaiaTiles().filter(tile => tile.level === 4)
const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const

// Exact RGB9_E5 values: galaxy is red, fine stars green, coarse stars blue.
// Every face has a different brightness, so an empty/stale/swapped cube is visible.
function tileData(tile: GaiaTile): ArrayBuffer {
  const buffer = new ArrayBuffer(gaiaTileByteLength(tile))
  for (const mip of splitGaiaTile(tile.level, new Uint32Array(buffer))) {
    mip.galaxy.fill((26 << 27) | ((tile.face + 1) * 64))
    mip.stars.fill((16 << 27) | (((tile.face + 1) * 32) << (mip.level <= 6 ? 9 : 18)))
  }
  return buffer
}

function contextEvent(canvas: HTMLCanvasElement, name: string, trigger: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      canvas.removeEventListener(name, listener)
    }
    const listener = (): void => { cleanup(); resolve() }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${name}`)) }, 10000)
    canvas.addEventListener(name, listener, { once: true })
    try { trigger() } catch (error) { cleanup(); reject(error) }
  })
}

interface Capture {
  mode: string
  face: number
  pixels: Float32Array
  mean: number[]
}

function captureSky(renderer: WebGLRenderer, uniforms: GaiaSkyUniforms): Capture[] {
  const skybox = new SkyboxBackground(null)
  const material = skybox.material as RawShaderMaterial
  if (!material.fragmentShader.includes('uniform highp samplerCube uGaiaGalaxy')) {
    throw new Error('Gaia recovery probe requires the production Gaia sky shader')
  }
  Object.assign(material.uniforms, uniforms)
  const scene = new Scene()
  scene.add(skybox)
  const target = new WebGLRenderTarget(16, 16, { type: FloatType })
  const camera = new PerspectiveCamera(35, 1, 0.1, 10)
  const captures: Capture[] = []
  try {
    for (const { mode, size, fov } of [
      { mode: 'fine', size: 16, fov: 35 },
      { mode: 'coarse', size: 4, fov: 150 }
    ]) {
      target.setSize(size, size)
      camera.fov = fov
      camera.updateProjectionMatrix()
      for (const [face, direction] of directions.entries()) {
        camera.up.set(0, Math.abs(direction[1]) === 1 ? 0 : 1, Math.abs(direction[1]) === 1 ? 1 : 0)
        camera.lookAt(direction[0], direction[1], direction[2])
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        const pixels = new Float32Array(size * size * 4)
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)
        const mean = [0, 0, 0]
        for (let i = 0; i < pixels.length; i += 4) {
          for (let channel = 0; channel < 3; channel++) mean[channel] += pixels[i + channel] / (size * size)
        }
        captures.push({ mode, face, pixels, mean })
      }
    }
    return captures
  } finally {
    // Only Gaia's raw textures span the loss. Dispose the probe's targets and
    // draw resources now; their recovery belongs to Three, outside this test.
    renderer.setRenderTarget(null)
    target.dispose()
    material.dispose()
    skybox.geometry.dispose()
  }
}

async function waitForReload(uniforms: GaiaSkyUniforms, requests: () => number, expected: number): Promise<boolean> {
  const deadline = performance.now() + 5000
  while (requests() < expected || uniforms.uGaiaMinLod.value !== 4) {
    if (performance.now() >= deadline) return false
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  return true
}

/** Real WebGL loss/restoration, real Gaia loader/upload/shader; no external archive or retained tile cache. */
export async function checkGaiaContextRecovery(): Promise<unknown> {
  const renderer = new WebGLRenderer()
  const uniforms = createGaiaSkyUniforms()
  uniforms.uGaiaOrientation.value.identity()
  uniforms.uGaiaExposure.value = 1
  let requests = 0
  const sky = new GaiaSky(renderer, uniforms, async tile => {
    requests++
    return tileData(tile)
  }, tails)
  const results: { cycle: number; requests: number; minLod: number; reloaded: boolean; maxError: number; colors: unknown[] }[] = []
  try {
    renderer.setSize(16, 16)
    document.body.appendChild(renderer.domElement)
    await sky.start()
    const before = captureSky(renderer, uniforms)
    for (const capture of before) {
      const starChannel = capture.mode === 'fine' ? 1 : 2
      if (!(capture.mean[0] > 0 && capture.mean[starChannel] > 0) || capture.pixels.some(value => !Number.isFinite(value))) {
        throw new Error(`Initial Gaia fixture is empty or invalid: ${JSON.stringify({ mode: capture.mode, face: capture.face, mean: capture.mean })}`)
      }
    }
    results.push({
      cycle: 0, requests, minLod: uniforms.uGaiaMinLod.value, reloaded: true, maxError: 0,
      colors: before.map(({ mode, face, mean }) => ({ mode, face, mean }))
    })
    for (let cycle = 1; cycle <= 2; cycle++) {
      await contextEvent(renderer.domElement, 'webglcontextlost', () => renderer.forceContextLoss())
      // Yield out of the loss event's task: restoreContext is legal after dispatch finishes.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      await contextEvent(renderer.domElement, 'webglcontextrestored', () => renderer.forceContextRestore())
      const reloaded = await waitForReload(uniforms, () => requests, tails.length * (cycle + 1))
      const after = captureSky(renderer, uniforms)
      let maxError = 0
      for (let i = 0; i < before.length; i++) {
        for (let p = 0; p < before[i].pixels.length; p++) {
          maxError = Math.max(maxError, Math.abs(before[i].pixels[p] - after[i].pixels[p]))
        }
      }
      results.push({ cycle, requests, minLod: uniforms.uGaiaMinLod.value, reloaded, maxError,
        colors: after.map(({ mode, face, mean }) => ({ mode, face, mean })) })
      if (!reloaded || !(maxError <= 1e-6)) {
        throw Object.assign(new Error(`Gaia did not recover its sky pixels after context loss (cycle ${cycle})`), { results })
      }
    }
    return results
  } finally {
    sky.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
}
