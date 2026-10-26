import {
  DataTexture, FloatType, GLSL3, Matrix4, Mesh, NoBlending, OrthographicCamera,
  PlaneGeometry, RawShaderMaterial, RGBAFormat, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'

type RGB = [number, number, number]
interface BackgroundCase {
  name: string
  expected: RGB
  enabled?: number
  projection?: [number, number]
  direction?: RGB
  centerDistance?: number
  depth?: number
  alpha?: number
  color?: 'tiles' | 'clamped'
  rotated?: boolean
}

const sky: RGB = [1.125, 1.25, 1.375], composite: RGB = [0.8125, 1.125, 1.6875]
const cases: BackgroundCase[] = [
  { name: 'scene disabled', enabled: 0, expected: sky },
  { name: 'below scene threshold', enabled: 0.499, expected: sky },
  { name: 'at scene threshold', enabled: 0.5, expected: composite },
  { name: 'projection behind camera', direction: [0, 0, 1], expected: [1.125, 1.25, 1.625] },
  { name: 'zero projection w', direction: [1, 0, 0], expected: [1.25, 1.25, 1.5] },
  { name: 'offscreen left', projection: [2, 0], expected: sky },
  { name: 'offscreen right', projection: [-2, 0], expected: sky },
  { name: 'offscreen bottom', projection: [0, 2], expected: sky },
  { name: 'offscreen top', projection: [0, -2], expected: sky },
  { name: 'left UV boundary', projection: [1, 0], expected: composite },
  { name: 'right UV boundary', projection: [-1, 0], expected: composite },
  { name: 'bottom UV boundary', projection: [0, 1], expected: composite },
  { name: 'top UV boundary', projection: [0, -1], expected: composite },
  { name: 'lower left texel', projection: [0.5, 0.5], color: 'tiles', expected: composite },
  { name: 'lower right texel', projection: [-0.5, 0.5], color: 'tiles', expected: [1.3125, 2.125, 3.6875] },
  { name: 'upper left texel', projection: [0.5, -0.5], color: 'tiles', expected: [2.3125, 4.125, 7.6875] },
  { name: 'upper right texel', projection: [-0.5, -0.5], color: 'tiles', expected: [4.3125, 8.125, 15.6875] },
  { name: 'foreground depth', depth: 0.5, expected: sky },
  { name: 'depth on closest plane', depth: 0.5, centerDistance: 3, expected: composite },
  { name: 'background depth', depth: 0.625, expected: composite },
  { name: 'empty scene depth', depth: 1, expected: composite },
  { name: 'negative layer subtraction is clamped', color: 'clamped', expected: [0.5625, 0.625, 1.6875] },
  { name: 'opaque sky layer', alpha: 0, expected: [0.25, 0.5, 1] },
  { name: 'fully transmissive sky layer', alpha: 1, expected: [1.375, 1.75, 2.375] },
  { name: 'camera-relative rotation changes projection', rotated: true, expected: sky }
]

/** Execute the production helper; literal HDR pixels protect every fallback and composition branch. */
export function checkBlackHoleBackgroundSampling(): object {
  const shader = BlackHoleShaderTemplate.fragmentShader
  const start = shader.indexOf('    vec3 sampleBackground('), end = shader.indexOf('\n    }\n', start)
  if (start < 0 || end < start) throw new Error('Missing production background function')
  const backgroundFunction = shader.slice(start, end + 6)
  const size = 8, renderer = new WebGLRenderer()
  renderer.setSize(size, size)
  const target = new WebGLRenderTarget(size, size, { type: FloatType, depthBuffer: false })
  const texture = (data: number[], width = 1, height = 1): DataTexture => {
    const result = new DataTexture(new Float32Array(data), width, height, RGBAFormat, FloatType)
    result.needsUpdate = true
    return result
  }
  const color = texture([0.5, 1, 2, 1]), clamped = texture([0, 0.25, 2, 1])
  const tiles = texture([0.5, 1, 2, 1, 1, 2, 4, 1, 2, 4, 8, 1, 4, 8, 16, 1], 2, 2)
  const depth = texture([1, 0, 0, 1]), layer = texture([0.25, 0.5, 1, 0.5])
  const modelView = new Matrix4(), projection = new Matrix4(), direction = new Vector3()
  const material = new RawShaderMaterial({
    glslVersion: GLSL3, blending: NoBlending, depthTest: false, depthWrite: false,
    uniforms: {
      uSceneEnabled: { value: 1 }, uSceneColor: { value: color }, uSceneDepth: { value: depth },
      uSkyLayer: { value: layer }, uSceneLogFarFactor: { value: 4 },
      crModelViewMatrix: { value: modelView }, crProjectionMatrix: { value: projection },
      direction: { value: direction }, dDx: { value: new Vector3(1, 0, 0) }, dDy: { value: new Vector3(0, 1, 0) },
      dPixDx: { value: new Vector3(0, 0, 1) }, dPixDy: { value: new Vector3(1, 1, 1) }
    },
    vertexShader: 'precision highp float; in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `precision highp float;
      uniform float uSceneEnabled, uSceneLogFarFactor;
      uniform sampler2D uSceneColor, uSceneDepth, uSkyLayer;
      uniform mat4 crModelViewMatrix, crProjectionMatrix;
      uniform vec3 direction, dDx, dDy, dPixDx, dPixDy;
      out vec4 fragColor;
      // Distinct contributions catch dropped or reordered sky arguments.
      vec3 sampleSkyLensed(vec3 direction, vec3 dDx, vec3 dDy, vec3 dPixDx, vec3 dPixDy) {
        return (direction + dDx + 2.0 * dDy + 4.0 * dPixDx + 8.0 * dPixDy) * 0.125;
      }
      ${backgroundFunction}
      void main() { fragColor = vec4(sampleBackground(direction, dDx, dDy, dPixDx, dPixDy), 1.0); }`
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const pixels = new Float32Array(size * size * 4)
  const results: { name: string; expected: number[]; firstPixel: number[]; mismatchedComponents: number }[] = []
  try {
    for (const fixture of cases) {
      modelView.identity()
      if (fixture.rotated) modelView.set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1)
      modelView.setPosition(0, 0, -(fixture.centerDistance ?? 4))
      projection.makePerspective(-1, 1, 1, -1, 1, 100)
      projection.elements[8] = fixture.projection?.[0] ?? 0
      projection.elements[9] = fixture.projection?.[1] ?? 0
      direction.fromArray(fixture.direction ?? [0, 0, -1])
      material.uniforms.uSceneEnabled.value = fixture.enabled ?? 1
      material.uniforms.uSceneColor.value = fixture.color === 'tiles' ? tiles : fixture.color === 'clamped' ? clamped : color
      depth.image.data![0] = fixture.depth ?? 1
      layer.image.data![3] = fixture.alpha ?? 0.5
      depth.needsUpdate = true
      layer.needsUpdate = true
      renderer.setRenderTarget(target)
      renderer.render(mesh, camera)
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)
      const gl = renderer.getContext(), program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
      if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS) || gl.getError() !== gl.NO_ERROR) throw new Error('Background sampling WebGL failure')
      const expected = [...fixture.expected, 1]
      let mismatchedComponents = 0
      for (let i = 0; i < pixels.length; i++) if (pixels[i] !== expected[i % 4]) mismatchedComponents++
      results.push({ name: fixture.name, expected, firstPixel: Array.from(pixels.subarray(0, 4)), mismatchedComponents })
    }
    if (results.some(result => result.mismatchedComponents)) throw Object.assign(new Error('Background sampling pixels differ from literal expectations'), { results })
    return { results }
  } finally {
    mesh.geometry.dispose()
    material.dispose()
    for (const item of [color, clamped, tiles, depth, layer]) item.dispose()
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
