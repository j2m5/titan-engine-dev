import {
  Camera, DataTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, Mesh,
  PlaneGeometry, Scene, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { ringShadowFunctions, ringShadowUniforms } from '@/core/materials/shaders/lib/chunks/RingShadow'
import { ringGapFunctions, ringGapUniforms } from '@/core/materials/shaders/lib/chunks/RingGap'

// Independent reference: all five implicit samples execute before deciding whether
// the ray intersects the ring plane. No derivatives occur after a divergent return.
const reference = /* glsl */ `
  float density(float coordinate, float center) {
    float alpha = texture2D(shadowRingsTexture, vec2(coordinate, 0.0)).a;
    return alpha * step(0.0, coordinate) * step(coordinate, 1.0)
      * ringGapMask(mix(shadowRingsInnerRadius, shadowRingsOuterRadius, coordinate));
  }
  vec3 referenceShadow(vec3 light, vec3 direction) {
    float distance = vPosition.y / (direction.y == 0.0 ? 1.0 : direction.y);
    vec2 intersection = (vPosition - distance * direction).xz;
    float span = shadowRingsOuterRadius - shadowRingsInnerRadius;
    float center = (length(intersection) - shadowRingsInnerRadius) / span;
    float width = min(distance * uRingSunTan / span, 4.0);
    float opacity = density(center - width, center)
      + 2.0 * density(center - 0.5 * width, center)
      + 3.0 * density(center, center)
      + 2.0 * density(center + 0.5 * width, center)
      + density(center + width, center);
    vec3 shadowed = light * (1.0 - opacity / 9.0);
    return direction.y != 0.0 && distance > 0.0 ? shadowed : light;
  }
`

function texture(kind: 'density' | 'mips' | 'flat'): DataTexture {
  const mipmaps: { data: Uint8Array; width: number; height: number }[] = []
  for (let level = 0, width = 512; width >= 1; level++, width /= 2) {
    const data = new Uint8Array(width * 4)
    for (let x = 0; x < width; x++) {
      const alpha = kind === 'mips' ? 12 + level * 24 : kind === 'flat' ? 153 : x % 16 < 8 ? 220 : 24
      data.set([255, 255, 255, alpha], x * 4)
    }
    mipmaps.push({ data, width, height: 1 })
  }
  const result = new DataTexture(mipmaps[0].data, 512, 1)
  result.minFilter = LinearMipmapLinearFilter
  result.magFilter = LinearFilter
  result.generateMipmaps = kind === 'density'
  if (!result.generateMipmaps) result.mipmaps = mipmaps
  result.needsUpdate = true
  return result
}

/** Catches divergent implicit sampling, lost mip filtering, missing penumbra
 * gradients and lost gap masks using the actual production GLSL chunk. */
export function checkRingShadowGradients() {
  const renderer = new WebGLRenderer({ antialias: false })
  renderer.setSize(33, 35)
  const gl = renderer.getContext()
  const previousLog = gl.getProgramInfoLog
  const descriptor = Object.getOwnPropertyDescriptor(gl, 'getProgramInfoLog')
  const warnings: { phase: string; text: string }[] = []
  let phase = 'setup'
  gl.getProgramInfoLog = function (program) {
    const value = previousLog.call(this, program)
    if (value?.trim()) warnings.push({ phase, text: value })
    return value
  }
  const maps = { density: texture('density'), mips: texture('mips'), flat: texture('flat') }
  const uniforms = {
    origin: { value: new Vector3(2, 1, 0) },
    axisX: { value: new Vector3() }, axisY: { value: new Vector3() },
    lightDirection: { value: new Vector3(0, 1, 0) },
    shadowRingsInnerRadius: { value: 1 }, shadowRingsOuterRadius: { value: 3 },
    shadowRingsTexture: { value: maps.flat }, uRingSunTan: { value: 0 },
    uRingGapCount: { value: 0 },
    uRingGaps: { value: [1.3, 1.8, 2.3, 2.8].map(radius => new Vector3(radius, 0.12, 0.03)) }
  }
  const vertexShader = `varying vec3 vPosition; uniform vec3 origin, axisX, axisY;
    void main() { vPosition = origin + position.x * axisX + position.y * axisY;
      gl_Position = vec4(position.xy, 0.0, 1.0); }`
  const material = (name: string, functions: string, call: string) => new ShaderMaterial({
    name, uniforms, vertexShader, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: `varying vec3 vPosition; uniform vec3 lightDirection;
      ${ringShadowUniforms} ${ringGapUniforms} ${ringGapFunctions} ${functions}
      void main() { gl_FragColor = vec4(${call}(vec3(0.8, 0.6, 0.4), normalize(lightDirection)), 1.0); }`
  })
  const candidate = material('RingShadow.Gradient.Candidate', ringShadowFunctions, 'getShadowFromRings')
  const expected = material('RingShadow.Coherent.Reference', reference, 'referenceShadow')
  const fixedLod = material('RingShadow.WrongLOD.Control', reference.replace(
    'texture2D(shadowRingsTexture, vec2(coordinate, 0.0))',
    'texture2DLodEXT(shadowRingsTexture, vec2(coordinate, 0.0), 0.0)'
  ), 'referenceShadow')
  const missingWidth = material('RingShadow.MissingWidth.Control', reference.replace(
    'texture2D(shadowRingsTexture, vec2(coordinate, 0.0))',
    'texture2DGradEXT(shadowRingsTexture, vec2(coordinate, 0.0), vec2(dFdx(center), 0.0), vec2(dFdy(center), 0.0))'
  ), 'referenceShadow')
  const geometry = new PlaneGeometry(2, 2), mesh = new Mesh(geometry, candidate)
  const scene = new Scene(); scene.add(mesh)
  const target = new WebGLRenderTarget(33, 35, { type: FloatType, depthBuffer: false })
  const camera = new Camera()
  const cases: { name: string; maxError: number; minimum: number; maximum: number; fixedLodDelta?: number; missingWidthDelta?: number }[] = []
  const readbacks: { name: string; actual: number[]; reference: number[] }[] = []
  const maxDifference = (a: Float32Array, b: Float32Array): number => {
    let maximum = 0
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return Infinity
      maximum = Math.max(maximum, Math.abs(a[i] - b[i]))
    }
    return maximum
  }
  const draw = (value: ShaderMaterial): Float32Array => {
    mesh.material = value
    renderer.setRenderTarget(target); renderer.render(scene, camera)
    const pixels = new Float32Array(target.width * target.height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
    if (gl.getError() !== gl.NO_ERROR) throw Error('Ring shadow readback WebGL error')
    return pixels
  }
  try {
    const inputs = [
      { name: 'flat-kernel', kind: 'flat', height: 1, dy: 0, dx: 0, tan: 0, gaps: 0 },
      { name: 'mip-filtering', kind: 'mips', height: 1, dy: 0, dx: 0.8, tan: 0, gaps: 0 },
      { name: 'penumbra-gradient', kind: 'mips', height: 0.5, dy: 0.4, dx: 0.04, tan: 0.8, gaps: 0 },
      { name: 'divergent-boundary', kind: 'mips', height: 0.013, dy: 0.8, dx: 0.1, tan: 0.8, gaps: 0 },
      { name: 'ring-edges', kind: 'density', height: 1, dy: 0.3, dx: 1.7, tan: 0.3, gaps: 0 },
      { name: 'four-gaps', kind: 'density', height: 1, dy: 0.3, dx: 1.7, tan: 0.3, gaps: 4 },
      { name: 'negative-distance', kind: 'flat', height: -1, dy: 0.3, dx: 0.8, tan: 0.3, gaps: 4 },
      { name: 'zero-distance', kind: 'flat', height: 0, dy: 0, dx: 0.8, tan: 0.3, gaps: 4 },
      { name: 'parallel-ray', kind: 'flat', height: 1, dy: 0.3, dx: 0.8, tan: 0.3, gaps: 0 }
    ] as const
    for (const input of inputs) {
      phase = input.name
      uniforms.origin.value.set(2, input.height, 0)
      uniforms.axisX.value.set(input.dx, 0, 0); uniforms.axisY.value.set(0, input.dy, 0)
      uniforms.lightDirection.value.set(input.name === 'parallel-ray' ? 1 : 0, input.name === 'parallel-ray' ? 0 : 1, 0)
      uniforms.shadowRingsTexture.value = maps[input.kind]
      uniforms.uRingSunTan.value = input.tan; uniforms.uRingGapCount.value = input.gaps
      const actual = draw(candidate), referencePixels = draw(expected)
      let minimum = Infinity, maximum = -Infinity
      for (let i = 0; i < actual.length; i += 4) { minimum = Math.min(minimum, actual[i]); maximum = Math.max(maximum, actual[i]) }
      const result: (typeof cases)[number] = { name: input.name, maxError: maxDifference(actual, referencePixels), minimum, maximum }
      if (input.name === 'mip-filtering') result.fixedLodDelta = maxDifference(referencePixels, draw(fixedLod))
      if (input.name === 'penumbra-gradient') result.missingWidthDelta = maxDifference(referencePixels, draw(missingWidth))
      cases.push(result)
      readbacks.push({ name: input.name, actual: [...actual], reference: [...referencePixels] })
    }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose(); geometry.dispose()
    for (const value of [candidate, expected, fixedLod, missingWidth]) value.dispose()
    for (const value of Object.values(maps)) value.dispose()
    if (descriptor) Object.defineProperty(gl, 'getProgramInfoLog', descriptor)
    else delete (gl as unknown as Record<string, unknown>).getProgramInfoLog
    renderer.dispose(); renderer.forceContextLoss()
  }
  const results = { warnings, cases, readbacks, texturesAfterDispose: renderer.info.memory.textures }
  const check = (condition: boolean, message: string) => { if (!condition) throw Object.assign(Error(message), { results }) }
  check(warnings.length === 0, `Ring shadow compiler warnings: ${JSON.stringify(warnings)}`)
  for (const item of cases) check(item.maxError <= 0.00002, `${item.name}: coherent reference error ${item.maxError}`)
  check(Math.abs(cases[0].minimum - 0.32) < 0.000001 && Math.abs(cases[0].maximum - 0.32) < 0.000001, 'Five-tap kernel normalizes constant alpha')
  check(cases.find(item => item.name === 'mip-filtering')!.fixedLodDelta! > 0.05, 'LOD0 negative control must change the image')
  check(cases.find(item => item.name === 'penumbra-gradient')!.missingWidthDelta! > 0.05, 'Missing penumbra gradient must change the image')
  for (const name of ['negative-distance', 'zero-distance', 'parallel-ray']) {
    const item = cases.find(item => item.name === name)!
    check(Math.abs(item.minimum - 0.8) < 0.000001 && Math.abs(item.maximum - 0.8) < 0.000001, `${name}: unchanged light`)
  }
  check(results.texturesAfterDispose === 0, 'Ring shadow probe releases GPU textures')
  return results
}
