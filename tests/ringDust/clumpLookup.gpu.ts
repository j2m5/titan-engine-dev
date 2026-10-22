import {
  DataTexture, DoubleSide, FloatType, Mesh, NoBlending, OrthographicCamera,
  PlaneGeometry, RGBAFormat, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'

const WIDTH = 256, HEIGHT = 64

function contextEvent(canvas: HTMLCanvasElement, name: string, trigger: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(timer); canvas.removeEventListener(name, listener) }
    const listener = (): void => { cleanup(); resolve() }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${name}`)) }, 10000)
    canvas.addEventListener(name, listener, { once: true })
    try { trigger() } catch (error) { cleanup(); reject(error) }
  })
}

/** Original procedural GLSL is the independent reference, including its float32 rounding.
 * Exercise the function installed in the real dust material, not a test copy of the lookup. */
export async function checkDustClumpLookup() {
  const material = new RingDustRaymarchMaterial(undefined, { clumps: true })
  const gradient = material.uniforms.uDustClumpGradients?.value as DataTexture | undefined
  if (!gradient?.isDataTexture) {
    material.dispose()
    throw new Error('Clumpy dust must own its gradient lookup')
  }
  const coordinates = new Float32Array(WIDTH * HEIGHT * 4)
  let seed = 123456789
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const boundaries = [-578, -290, -289, -288, -1, 0, 1, 288, 289, 290, 577, 578]
  for (let point = 0; point < WIDTH * HEIGHT; point++) {
    if (point < boundaries.length ** 3 * 3) {
      const cell = Math.floor(point / 3), epsilon = [-0.00003, 0, 0.00003][point % 3]
      const x = boundaries[cell % boundaries.length]
      const y = boundaries[Math.floor(cell / boundaries.length) % boundaries.length]
      const z = boundaries[Math.floor(cell / boundaries.length ** 2) % boundaries.length]
      const unskew = (x + y + z) / 6
      coordinates.set([x - unskew + epsilon, y - unskew, z - unskew - epsilon, 1], point * 4)
    } else {
      const scale = point % 2 ? 1000 : 10000
      coordinates.set([(random() * 2 - 1) * scale, (random() * 2 - 1) * scale, (random() * 2 - 1) * scale, 1], point * 4)
    }
  }
  const input = new DataTexture(coordinates, WIDTH, HEIGHT, RGBAFormat, FloatType)
  input.needsUpdate = true
  const renderer = new WebGLRenderer()
  renderer.setSize(WIDTH, HEIGHT)
  const gl = renderer.getContext()
  const target = new WebGLRenderTarget(WIDTH, HEIGHT, { type: FloatType, depthBuffer: false })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material), camera = new OrthographicCamera()
  mesh.frustumCulled = false
  const main = material.fragmentShader.indexOf('void main()')
  material.uniforms.uCoordinates = { value: input }
  material.vertexShader = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }'
  material.fragmentShader = `${material.fragmentShader.slice(0, main)}
    ${noiseFunctions}
    uniform sampler2D uCoordinates;
    void main() {
      vec3 p = texelFetch(uCoordinates, ivec2(gl_FragCoord.xy), 0).xyz;
      float actual = dustClumpNoise(p), reference = snoise(p);
      gl_FragColor = vec4(actual, reference,
        actual + 0.5 * dustClumpNoise(p * 2.0), reference + 0.5 * snoise(p * 2.0));
    }`
  material.side = DoubleSide
  material.blending = NoBlending
  const sample = (): Float32Array => {
    renderer.setRenderTarget(target)
    renderer.render(mesh, camera)
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS) || gl.getUniformLocation(program, 'uDustClumpGradients') === null) {
      throw new Error('Dust clump lookup is not active in the linked GPU program')
    }
    const pixels = new Float32Array(WIDTH * HEIGHT * 4)
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Dust clump probe WebGL error')
    return pixels
  }
  try {
    if (main < 0) throw new Error('Dust fragment entry point missing')
    const before = sample()
    let maxSingleError = 0, maxOctaveError = 0, min = Infinity, max = -Infinity
    for (let i = 0; i < before.length; i += 4) {
      const single = Math.abs(before[i] - before[i + 1]), octave = Math.abs(before[i + 2] - before[i + 3])
      if (!Number.isFinite(single) || !Number.isFinite(octave) || single > 4e-6 || octave > 4e-6) {
        throw new Error(`Dust lookup mismatch at ${Array.from(coordinates.slice(i, i + 3))}: ${single}/${octave}`)
      }
      maxSingleError = Math.max(maxSingleError, single); maxOctaveError = Math.max(maxOctaveError, octave)
      min = Math.min(min, before[i + 1]); max = Math.max(max, before[i + 1])
    }
    if (min > -0.5 || max < 0.5) throw new Error('Dust reference field did not cover a useful range')
    // Three materials may be rendered again after dispose (GPU cache eviction).
    // Reupload must still leave a resource the material can release next time.
    const beforeReuse = renderer.info.memory.textures
    material.dispose()
    if (renderer.info.memory.textures !== beforeReuse - 1) throw new Error('Dust material retained its uploaded lookup')
    const reused = sample()
    if (before.some((value, i) => value !== reused[i])) throw new Error('Dust noise changed after material reuse')
    material.dispose()
    if (renderer.info.memory.textures !== beforeReuse - 1) throw new Error('Reused dust material retained its uploaded lookup')
    sample()
    renderer.setRenderTarget(null)
    target.dispose(); mesh.geometry.dispose()
    await contextEvent(renderer.domElement, 'webglcontextlost', () => renderer.forceContextLoss())
    await new Promise(resolve => setTimeout(resolve, 100))
    await contextEvent(renderer.domElement, 'webglcontextrestored', () => renderer.forceContextRestore())
    const after = sample()
    if (before.some((value, i) => value !== after[i])) throw new Error('Dust noise changed after context restoration')
    if (gradient.image.data?.byteLength !== 1336336) throw new Error('Dust gradient source lost during context restoration')
    const texturesBeforeDispose = renderer.info.memory.textures
    material.dispose()
    const texturesAfterDispose = renderer.info.memory.textures
    if (texturesAfterDispose !== texturesBeforeDispose - 1) throw new Error('Dust material retained its uploaded lookup')
    return { points: WIDTH * HEIGHT, maxSingleError, maxOctaveError, referenceRange: [min, max], restoredIdentically: true,
      reusedIdentically: true, lookupBytes: gradient.image.data.byteLength, texturesBeforeDispose, texturesAfterDispose }
  } finally {
    renderer.setRenderTarget(null)
    material.dispose(); input.dispose(); mesh.geometry.dispose(); target.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
