import {
  LoadingManager, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Vector3, WebGLRenderer, WebGLRenderTarget, type CubeTexture
} from 'three'
import { CubeStrategy } from '@/core/textures/strategies/CubeStrategy'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'

/** The runner holds abortUrl's response open; all cube images are local synthetic PNG blobs. */
export async function checkTextureCancellationAndCube(abortUrl: string): Promise<{
  cancellation: string; pixels: number[][]; expected: number[][]; closedWidths: number[]
}> {
  const manager = new LoadingManager()
  manager.setURLModifier(() => abortUrl)
  const controller = new AbortController()
  // Install before fetch. The runner signals only after native Chromium observes HTTP headers.
  const abortAfterHeaders = (): void => controller.abort()
  window.addEventListener('titan-test-texture-response', abortAfterHeaders, { once: true })
  let cancellation = ''
  try {
    await ImageBitmapStrategy.create(manager).load({
      paths: ['abort.png'], name: 'abort', resourceType: 'diffuse', params: {}
    }, controller.signal)
  } catch (cause) {
    cancellation = (cause as Error).name
  } finally {
    window.removeEventListener('titan-test-texture-response', abortAfterHeaders)
  }
  if (cancellation !== 'AbortError') throw new Error(`Transport did not abort: ${cancellation}`)

  const renderer = new WebGLRenderer()
  const target = new WebGLRenderTarget(1, 1)
  const geometry = new PlaneGeometry(2, 2)
  const material = new ShaderMaterial({
    uniforms: { source: { value: null }, direction: { value: new Vector3() } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform samplerCube source; uniform vec3 direction; void main() { gl_FragColor = textureCube(source, direction); }'
  })
  const urls: string[] = []
  let cube: CubeTexture | undefined
  try {
    // Each face has a distinct upper/lower half. Sampling off-center detects vertical flips;
    // midtone channels detect missing sRGB-to-linear conversion as well as face permutation.
    const upper = [[200, 70, 40], [50, 180, 90], [60, 90, 190], [170, 120, 60], [120, 60, 180], [80, 160, 170]]
    const lower = upper.map((rgb) => rgb.map((value) => Math.floor(value / 2)))
    for (let face = 0; face < 6; face++) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 4
      const context = canvas.getContext('2d')!
      context.fillStyle = `rgb(${upper[face].join(',')})`
      context.fillRect(0, 0, 4, 2)
      context.fillStyle = `rgb(${lower[face].join(',')})`
      context.fillRect(0, 2, 4, 2)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encode failed'))))
      urls.push(URL.createObjectURL(blob))
    }
    const cubeManager = new LoadingManager()
    let faceIndex = 0
    cubeManager.setURLModifier(() => urls[faceIndex++])
    cube = await CubeStrategy.create(cubeManager).load({ paths: urls, name: 'cube', params: {}, resourceType: 'cube' })
    material.uniforms.source.value = cube
    const scene = new Scene()
    scene.add(new Mesh(geometry, material))
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    // OpenGL cubemap t=(tc/major+1)/2, and no ImageBitmap flip means the top PNG
    // row occupies t=0. tc=-y except +Y uses z and -Y uses -z.
    const directions = [new Vector3(1, 0.5, 0), new Vector3(-1, 0.5, 0), new Vector3(0, 1, -0.5),
      new Vector3(0, -1, 0.5), new Vector3(0, 0.5, 1), new Vector3(0, 0.5, -1)]
    const linearByte = (value: number): number => Math.round(255 * (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4))
    const expected = upper.map((rgb) => [...rgb.map(linearByte), 255])
    const pixels: number[][] = []
    renderer.setRenderTarget(target)
    for (let face = 0; face < 6; face++) {
      material.uniforms.direction.value.copy(directions[face])
      renderer.render(scene, camera)
      const pixel = new Uint8Array(4)
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
      pixels.push(Array.from(pixel))
      if (pixel.some((value, channel) => Math.abs(value - expected[face][channel]) > 2)) {
        throw new Error(`Cube face ${face}: actual=${pixel}, expected=${expected[face]}`)
      }
    }
    const sources = cube.images as ImageBitmap[]
    cube.dispose()
    const closedWidths = sources.map((source) => source.width)
    if (closedWidths.some((width) => width !== 0)) throw new Error('Cube bitmap survived final disposal')
    return { cancellation, pixels, expected, closedWidths }
  } finally {
    cube?.dispose()
    for (const url of urls) URL.revokeObjectURL(url)
    geometry.dispose()
    material.dispose()
    target.dispose()
    renderer.dispose()
  }
}
