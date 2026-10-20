import {
  Mesh, MeshBasicMaterial, OrthographicCamera,
  PlaneGeometry, Scene, Texture, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'

function contextEvent(canvas: HTMLCanvasElement, name: string, trigger: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      canvas.removeEventListener(name, listener)
    }
    const listener = (): void => { cleanup(); resolve() }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${name}`))
    }, 10000)
    canvas.addEventListener(name, listener, { once: true })
    try { trigger() } catch (error) { cleanup(); reject(error) }
  })
}

/**
 * Real WebGL source lifetime, isolated from the application/composer recovery path.
 * await import('/tests/textures/ImageBitmapLifecycle.gpu.ts').then(m => m.checkImageBitmapLifecycle())
 */
export async function checkImageBitmapLifecycle(): Promise<{
  before: number[]; after: number[]; initialWidth: number; widthWhileLost: number; finalWidth: number
}> {
  const renderer = new WebGLRenderer()
  let bitmap: ImageBitmap | undefined
  let texture: Texture | undefined
  const geometry = new PlaneGeometry(2, 2)
  const material = new MeshBasicMaterial()
  const target = new WebGLRenderTarget(4, 4)
  try {
    renderer.setSize(16, 16)
    document.body.appendChild(renderer.domElement)
    bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray([
      200, 80, 40, 255, 200, 80, 40, 255, 200, 80, 40, 255, 200, 80, 40, 255
    ]), 2, 2))
    const source = bitmap
    const strategy = new ImageBitmapStrategy({ loadAsync: async () => source })
    texture = await strategy.load({ name: 'lifecycle', paths: ['lifecycle.png'], resourceType: 'diffuse', params: {} })
    material.map = texture
    const scene = new Scene()
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 2
    scene.add(new Mesh(geometry, material))
    const sample = (): number[] => {
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      const pixel = new Uint8Array(4)
      renderer.readRenderTargetPixels(target, 2, 2, 1, 1, pixel)
      return Array.from(pixel)
    }
    const before = sample()
    const initialWidth = bitmap.width
    if (initialWidth !== 2) throw new Error('Bitmap closed during initial upload')
    await contextEvent(renderer.domElement, 'webglcontextlost', () => renderer.forceContextLoss())
    const widthWhileLost = bitmap.width
    if (widthWhileLost !== 2) throw new Error('Bitmap closed during context loss')
    // Allow loss-event dispatch to finish before requesting restoration.
    await new Promise(resolve => setTimeout(resolve, 100))
    await contextEvent(renderer.domElement, 'webglcontextrestored', () => renderer.forceContextRestore())
    const after = sample()
    if (before.join(',') !== '200,80,40,255' || before.join(',') !== after.join(',')) {
      throw new Error(`Unexpected pixels across context restoration: ${JSON.stringify({ before, after })}`)
    }
    if (bitmap.width !== 2) throw new Error('Bitmap closed during restoration upload')
    texture.dispose()
    const finalWidth = Number(bitmap.width)
    if (finalWidth !== 0) throw new Error(`Bitmap remains open after final texture disposal: width=${finalWidth}`)
    return { before, after, initialWidth, widthWhileLost, finalWidth }
  } finally {
    texture?.dispose()
    material.dispose()
    geometry.dispose()
    target.dispose()
    renderer.dispose()
    renderer.domElement.remove()
    bitmap?.close()
  }
}
