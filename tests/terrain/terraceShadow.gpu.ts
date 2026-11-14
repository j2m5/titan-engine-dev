import {
  FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Uniform, Vector4, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { terrainMacroDetailFunctions } from '@/core/materials/shaders/lib/chunks/TerrainMacroDetail'
import { TERRACE_EDGE_PHASE, TERRACE_EDGE_PROFILE, terraceProfile } from '@/core/materials/shaders/lib/chunks/terrainMacroDetailMath'

/** Actual production GLSL: a lit terrace crest must not become a dark contour. */
export function checkTerraceShadow() {
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  const target = new WebGLRenderTarget(1, 1, {
    type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false
  })
  // The profile/shadow functions precede the independent streak and macro-noise functions.
  const functions = terrainMacroDetailFunctions.slice(0, terrainMacroDetailFunctions.indexOf('  vec3 streakPlane('))
  const uniforms = { params: new Uniform(new Vector4()), footprint: new Uniform(0) }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform vec4 params;
      uniform float footprint;
      ${functions}
      void main() {
        vec2 s = normalize(vec2(params.z, 1.0));
        float light = terraceCastShadow(params.x, terraceProfile(params.x).x, params.y, s.x, s.y, params.w, footprint);
        gl_FragColor = vec4(vec3(light), 1.0);
      }
    `
  })
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const results = { checks: 0, maxError: 0 }
  const read = (phase: number, sunTan: number, footprint: number): number => {
    uniforms.params.value.set(phase, 0.5, sunTan, 0.4)
    uniforms.footprint.value = footprint
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixel = new Float32Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    const gl = renderer.getContext()
    if (gl.getError() !== gl.NO_ERROR || !Number.isFinite(pixel[0])) throw new Error('Invalid terrace shadow readback')
    return pixel[0]
  }
  const check = (phase: number, sunTan: number, footprint: number, expected: number) => {
    const actual = read(phase, sunTan, footprint)
    const error = Math.abs(actual - expected)
    if (error > 0.001) throw new Error(`Terrace phase=${phase}, sun=${sunTan}, footprint=${footprint}: expected ${expected}, got ${actual}`)
    results.checks++
    results.maxError = Math.max(results.maxError, error)
  }
  try {
    for (const footprint of [0, 0.001, 0.02, 0.2]) {
      for (const offset of [-1e-5, 0, 1e-5]) check(TERRACE_EDGE_PHASE + offset, 2, footprint, 1)
      for (let i = 0; i <= 100; i++) check(i / 100, 0.804, footprint, 1)
    }
    check(0.95, 0.45, 0, 0)
    check(0.95, 2, 0, 1)
    const u = TERRACE_EDGE_PHASE + 1 - 0.95
    const g = (0.5 * (TERRACE_EDGE_PROFILE - terraceProfile(0.95).value)) / u
    check(0.95, 0.4 * (1 + g), 0.05, 0.5)
    for (const footprint of [0.005, 0.02, 0.1]) {
      for (const phase of [TERRACE_EDGE_PHASE, TERRACE_EDGE_PHASE - 0.001]) {
        const jump = Math.abs(read(phase - 1e-6, 0.42, footprint) - read(phase + 1e-6, 0.42, footprint))
        if (jump > 0.001) throw new Error(`Terrace crest discontinuity: ${jump}, phase=${phase}, footprint=${footprint}`)
        results.checks++
      }
    }
    return results
  } finally {
    geometry.dispose()
    material.dispose()
    target.dispose()
    renderer.dispose()
  }
}
