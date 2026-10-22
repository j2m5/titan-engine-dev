import {
  Color, FloatType, Mesh, NoBlending, OrthographicCamera, PlaneGeometry,
  ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { ringDustFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { createDustRadialTexture } from '@/core/renderables/DetailedRingStreamingSystem/dust/DustRadialProfile'
import { tauRay, type DustParams } from './tauMirror'

const WIDTH = 64
const cases = [
  { name: 'horizontal inside', origin: [125, 0, 0], direction: [1, 0, 0], length: 100 },
  { name: 'horizontal elevated', origin: [125, 6, 0], direction: [-1, 0, 0], length: 300 },
  { name: 'almost horizontal positive', origin: [125, 1, 0], direction: [-1, 5e-9, 0], length: 300 },
  { name: 'almost horizontal negative', origin: [125, 1, 0], direction: [-1, -5e-9, 0], length: 300 },
  { name: 'inclined away from plane', origin: [125, 1, 0], direction: [1, 0.2, 0], length: 100 },
  { name: 'inclined toward plane', origin: [125, 6, 0], direction: [1, -0.2, 0], length: 100 },
  { name: 'inclined below plane', origin: [125, -6, 0], direction: [1, 0.2, 0], length: 100 },
  { name: 'vertical in ring', origin: [125, 20, 0], direction: [0, -1, 0], length: 80 },
  { name: 'vertical in hole', origin: [0, 20, 0], direction: [0, -1, 0], length: 80 },
  { name: 'two ring intervals', origin: [200, 0, 0], direction: [-1, 0, 0], length: 450 },
  { name: 'plane crossing and hole', origin: [200, 10, 0], direction: [-1, -0.04, 0], length: 450 },
  { name: 'missed ring', origin: [200, 0, 0], direction: [0, 0, 1], length: 300 }
].map(ray => ({ ...ray, origin: new Vector3(...ray.origin), direction: new Vector3(...ray.direction).normalize() }))

/** Execute the shared asteroid-fog integrator, including both PieceMask branches.
 * Native ANGLE diagnostics are checked by the browser fixture, independently of pixels. */
export function checkRingDustAnalyticProgram() {
  const renderer = new WebGLRenderer()
  renderer.setSize(WIDTH, cases.length)
  renderer.setClearColor(0, 0)
  const gl = renderer.getContext()
  const profile = createDustRadialTexture(Float32Array.from({ length: 32 }, (_, i) =>
    0.1 + 0.9 * Math.pow(Math.sin((i + 0.5) / 32 * Math.PI * 3), 2)))!
  const params: DustParams = { rho0: 0.02, H: 4, rIn: 100, rOut: 150 }
  const material = new ShaderMaterial({
    uniforms: {
      uDustDensity: { value: params.rho0 }, uDustScaleHeight: { value: params.H },
      uDustRingInner: { value: params.rIn }, uDustRingOuter: { value: params.rOut },
      uDustRadialMap: { value: profile.texture }, uDustRadialMapScale: { value: 0 },
      uDustColor: { value: new Color(1, 1, 1) },
      uOrigins: { value: cases.map(ray => ray.origin) },
      uDirections: { value: cases.map(ray => ray.direction) },
      uLengths: { value: cases.map(ray => ray.length) }
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      ${ringDustUniforms}
      ${ringDustFunctions}
      uniform vec3 uOrigins[${cases.length}];
      uniform vec3 uDirections[${cases.length}];
      uniform float uLengths[${cases.length}];
      void main() {
        int row = int(gl_FragCoord.y);
        float distance = uLengths[row] * gl_FragCoord.x / ${WIDTH}.0;
        vec2 span;
        float tau = ringDustTauRay(uOrigins[row], uDirections[row], distance, span);
        gl_FragColor = vec4(tau, span, 1.0);
      }
    `,
    depthTest: false, depthWrite: false, blending: NoBlending
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  const camera = new OrthographicCamera()
  const target = new WebGLRenderTarget(WIDTH, cases.length, { type: FloatType, depthBuffer: false })
  const results: { profile: boolean; maxTauError: number; maxSpanError: number; positive: number; empty: number }[] = []
  try {
    for (const enabled of [false, true]) {
      material.uniforms.uDustRadialMapScale.value = enabled ? profile.scale : 0
      params.profile = enabled ? { bins: Float32Array.from(profile.texture.image.data!, byte => byte / 255), scale: profile.scale } : undefined
      renderer.setRenderTarget(target)
      renderer.render(mesh, camera)
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
      if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Dust analytic program did not link')
      const pixels = new Float32Array(WIDTH * cases.length * 4)
      renderer.readRenderTargetPixels(target, 0, 0, WIDTH, cases.length, pixels)
      let maxTauError = 0, maxSpanError = 0, positive = 0, empty = 0
      for (let row = 0; row < cases.length; row++) {
        const ray = cases[row]
        for (let x = 0; x < WIDTH; x++) {
          const expected = tauRay(ray.origin, ray.direction, ray.length * (x + 0.5) / WIDTH, params)
          const offset = (row * WIDTH + x) * 4, tau = pixels[offset]
          const tauError = Math.abs(tau - expected.tau)
          const spanError = Math.max(Math.abs(pixels[offset + 1] - expected.span[0]), Math.abs(pixels[offset + 2] - expected.span[1]))
          if (!Number.isFinite(tau) || tau < 0 || !Number.isFinite(spanError) || pixels[offset + 3] !== 1 || tauError > 0.002 || spanError > 0.001) {
            throw new Error(`Dust analytic mismatch: ${ray.name}, x=${x}, profile=${enabled}, tau=${tau}/${expected.tau}, spanError=${spanError}`)
          }
          if (expected.tau > 0) positive++; else { empty++; if (tau !== 0) throw new Error(`Dust leaked into empty ray: ${ray.name}`) }
          maxTauError = Math.max(maxTauError, tauError); maxSpanError = Math.max(maxSpanError, spanError)
        }
      }
      if (positive === 0 || empty === 0 || gl.getError() !== gl.NO_ERROR) throw new Error('Dust analytic probe did not exercise valid nonempty and empty rays')
      results.push({ profile: enabled, maxTauError, maxSpanError, positive, empty })
    }
    return { rays: cases.map(ray => ray.name), samplesPerRay: WIDTH, results }
  } finally {
    renderer.setRenderTarget(null)
    mesh.geometry.dispose(); material.dispose(); profile.texture.dispose(); target.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
