import {
  Mesh, MeshBasicMaterial, OrthographicCamera,
  PlaneGeometry, Scene, ShaderMaterial, Texture, Vector3, WebGLRenderer, WebGLRenderTarget, type CubeTexture
} from 'three'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { CubeStrategy } from '@/core/textures/strategies/CubeStrategy'
import { bindResourceStorageContext, resourceStorage } from '@/core/services/ResourceStorage'

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
 * Real raster/cubemap pixels through the application's resource-storage recovery binding.
 * await import('/tests/textures/ImageBitmapLifecycle.gpu.ts').then(m => m.checkImageBitmapLifecycle())
 */
export async function checkImageBitmapLifecycle(): Promise<{
  before: number[]; after: number[]; initialWidth: number; widthWhileLost: number; finalWidth: number;
  cubeBefore: number[][]; cubeAfter: number[][]; cubeClosedWidths: number[]; restoreCycles: number
}> {
  if (resourceStorage.getCountTextures() !== 0) throw new Error('Bitmap lifecycle probe requires empty resource storage')
  const renderer = new WebGLRenderer()
  const releaseContext = bindResourceStorageContext(renderer)
  let bitmap: ImageBitmap | undefined
  let texture: Texture | undefined
  let cube: CubeTexture | undefined
  const cubeBitmaps: ImageBitmap[] = []
  const geometry = new PlaneGeometry(2, 2)
  const material = new MeshBasicMaterial()
  const cubeMaterial = new ShaderMaterial({
    uniforms: { source: { value: null }, direction: { value: new Vector3() } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform samplerCube source; uniform vec3 direction; void main() { gl_FragColor = textureCube(source, direction); }'
  })
  const target = new WebGLRenderTarget(4, 4)
  try {
    renderer.setSize(16, 16)
    document.body.appendChild(renderer.domElement)
    bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray([
      200, 80, 40, 255, 200, 80, 40, 255, 200, 80, 40, 255, 200, 80, 40, 255
    ]), 2, 2))
    const source = bitmap
    let rasterLoads = 0
    const strategy = new ImageBitmapStrategy({ loadAsync: async () => { rasterLoads++; return source } })
    texture = await strategy.load({ name: 'lifecycle', paths: ['lifecycle.png'], resourceType: 'diffuse', params: {} })
    texture.name = 'lifecycle-raster'
    resourceStorage.addTexture(texture)
    material.map = texture
    const scene = new Scene()
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 2
    scene.add(new Mesh(geometry, material))
    // Distinct saturated faces avoid color-space rounding and expose lost cube sources.
    const cubeExpected = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255],
      [255, 255, 0, 255], [255, 0, 255, 255], [0, 255, 255, 255]]
    for (const color of cubeExpected) {
      cubeBitmaps.push(await createImageBitmap(new ImageData(new Uint8ClampedArray([
        ...color, ...color, ...color, ...color
      ]), 2, 2)))
    }
    let cubeLoads = 0
    cube = await new CubeStrategy({ loadAsync: async () => cubeBitmaps[cubeLoads++] }).load({
      name: 'lifecycle-cube', paths: ['px', 'nx', 'py', 'ny', 'pz', 'nz'], resourceType: 'cube', params: {}
    })
    cube.name = 'lifecycle-cube'
    resourceStorage.addTexture(cube)
    cubeMaterial.uniforms.source.value = cube
    const cubeScene = new Scene()
    cubeScene.add(new Mesh(geometry, cubeMaterial))
    const directions = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0),
      new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
    const sample = (): number[] => {
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      const pixel = new Uint8Array(4)
      renderer.readRenderTargetPixels(target, 2, 2, 1, 1, pixel)
      return Array.from(pixel)
    }
    const before = sample()
    const sampleCube = (): number[][] => directions.map(direction => {
      cubeMaterial.uniforms.direction.value.copy(direction)
      renderer.setRenderTarget(target)
      renderer.render(cubeScene, camera)
      const pixel = new Uint8Array(4)
      renderer.readRenderTargetPixels(target, 2, 2, 1, 1, pixel)
      return Array.from(pixel)
    })
    const cubeBefore = sampleCube()
    if (before.join(',') !== '200,80,40,255' || JSON.stringify(cubeBefore) !== JSON.stringify(cubeExpected)) {
      throw new Error(`Unexpected initial bitmap pixels: ${JSON.stringify({ before, cubeBefore })}`)
    }
    const initialWidth = bitmap.width
    if (initialWidth !== 2) throw new Error('Bitmap closed during initial upload')
    let widthWhileLost = 0, after = before, cubeAfter = cubeBefore
    const restoreCycles = 2
    for (let cycle = 0; cycle < restoreCycles; cycle++) {
      await contextEvent(renderer.domElement, 'webglcontextlost', () => renderer.forceContextLoss())
      widthWhileLost = bitmap.width
      if (widthWhileLost !== 2 || cubeBitmaps.some(face => face.width !== 2)) {
        throw new Error(`Bitmap closed during context loss: cycle=${cycle}, raster=${widthWhileLost}, cube=${cubeBitmaps.map(face => face.width)}`)
      }
      // Allow loss-event dispatch to finish before requesting restoration.
      await new Promise(resolve => setTimeout(resolve, 100))
      await contextEvent(renderer.domElement, 'webglcontextrestored', () => renderer.forceContextRestore())
      after = sample()
      cubeAfter = sampleCube()
      if (before.join(',') !== after.join(',') || JSON.stringify(cubeAfter) !== JSON.stringify(cubeExpected)) {
        throw new Error(`Unexpected pixels across context restoration: ${JSON.stringify({ cycle, before, after, cubeAfter })}`)
      }
      if (resourceStorage.getTexture(texture.name) !== texture || resourceStorage.getTexture(cube.name) !== cube) {
        throw new Error('Context restoration replaced resident texture identities')
      }
    }
    if (rasterLoads !== 1 || cubeLoads !== 6) throw new Error('Context restoration reloaded bitmap sources')
    if (bitmap.width !== 2 || cubeBitmaps.some(face => face.width !== 2)) throw new Error('Bitmap closed during restoration upload')
    resourceStorage.deleteTexture(texture.name)
    resourceStorage.deleteTexture(cube.name)
    const finalWidth = Number(bitmap.width)
    const cubeClosedWidths = cubeBitmaps.map(face => face.width)
    if (finalWidth !== 0 || cubeClosedWidths.some(width => width !== 0)) throw new Error('Bitmap remains open after final storage eviction')
    return { before, after, initialWidth, widthWhileLost, finalWidth, cubeBefore, cubeAfter, cubeClosedWidths, restoreCycles }
  } finally {
    releaseContext()
    if (texture) resourceStorage.deleteTexture(texture.name)
    if (cube) resourceStorage.deleteTexture(cube.name)
    texture?.dispose()
    cube?.dispose()
    material.dispose()
    cubeMaterial.dispose()
    geometry.dispose()
    target.dispose()
    renderer.dispose()
    renderer.domElement.remove()
    if (bitmap?.width) bitmap.close()
    for (const face of cubeBitmaps) if (face.width) face.close()
  }
}
