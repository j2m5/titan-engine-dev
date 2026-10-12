import {
  Camera, FloatType, GLSL3, Mesh, NoBlending, PlaneGeometry,
  RawShaderMaterial, Scene, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { RenderingObjects } from '@storage/database'
import { createAtmosphereUniforms, type AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { createParametricAtmosphereShader } from '@/core/renderables/Atmosphere/atmosphereParametric'

/**
 * GPU-регрессия, запускается через Vite в браузере:
 * await import('/tests/atmosphere/terminator.gpu.ts').then(m => m.checkAtmosphereTerminator())
 *
 * Луч до границы атмосферы должен давать ту же радиацию в ToPoint и Sky.
 * Отсечка Ми по солнечному углу в начале луча нарушала это тождество:
 * выключала освещённый участок луча при mu_s <= 0 и рисовала второй терминатор.
 * Проверяем реальные LUT, с орбиты до грунта и с грунта в небо на закате.
 */
export function checkAtmosphereTerminator(): Array<{ name: string; maxRelativeError: number; nightRadiance: number }> {
  const renderer = new WebGLRenderer()
  const width = 128, height = 4
  const target = new WebGLRenderTarget(width, height, { type: FloatType, depthBuffer: false })
  const geometry = new PlaneGeometry(2, 2)
  const camera = new Camera(), scene = new Scene()
  const generator = new AtmosphereLUTGenerator(renderer)
  const results: Array<{ name: string; maxRelativeError: number; nightRadiance: number }> = []
  const shaderErrors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderErrors.push(gl.getProgramInfoLog(program) ?? '', gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
  }
  try {
    for (const [name, actorId] of [['Neptune', 52], ['Uranus', 51], ['Darkness', 91], ['Venus', 46], ['Earth', 47]] as const) {
      const config = RenderingObjects.find(row => row.actorId === actorId)!.data as unknown as AtmosphereConfig
      const lut = generator.generate(config)
      const material = new RawShaderMaterial({
        glslVersion: GLSL3, depthTest: false, depthWrite: false, blending: NoBlending,
        uniforms: {
          ...createAtmosphereUniforms(config),
          transmittance_texture: { value: lut.transmittance },
          scattering_texture: { value: lut.scattering },
          single_mie_scattering_texture: { value: lut.scattering },
          irradiance_texture: { value: lut.irradiance },
          segmentFraction: { value: 1 }
        },
        vertexShader: 'precision highp float; in vec3 position; void main() { gl_Position = vec4(position, 1.0); }',
        fragmentShader: createParametricAtmosphereShader() + /* glsl */ `
          uniform float segmentFraction;
          out vec4 fragColor;
          void main() {
            AtmosphereParameters atm = buildAtmosphere();
            float muS = mix(-0.1, 0.1, (gl_FragCoord.x - 0.5) / 127.0);
            if (gl_FragCoord.x < 1.0) muS = -0.8;
            if (gl_FragCoord.x > 127.0) muS = 0.8;
            vec3 sun = vec3(sqrt(1.0 - muS * muS), 0.0, muS);
            bool fromSpace = gl_FragCoord.y < 2.0;
            vec3 origin = vec3(0.0, 0.0, fromSpace ? atm.top_radius : atm.bottom_radius + 0.01);
            vec3 dir = normalize(fromSpace ? vec3(0.8, 0.0, -1.0) : vec3(1.0, 0.0, 0.02));
            float r = length(origin), mu = dir.z;
            float d = fromSpace ? DistanceToBottomAtmosphereBoundary(atm, r, mu)
                                : DistanceToTopAtmosphereBoundary(atm, r, mu);
            vec3 transmittance;
            vec3 radiance = mod(floor(gl_FragCoord.y), 2.0) < 0.5
              ? GetSkyRadianceToPoint(origin, origin + dir * d * segmentFraction, 0.0, sun, transmittance)
              : GetSkyRadiance(origin, dir, 0.0, sun, transmittance);
            fragColor = vec4(radiance, 1.0);
          }
        `
      })
      const quad = new Mesh(geometry, material)
      scene.add(quad)
      try {
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        const pixels = new Float32Array(width * height * 4)
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
        if (shaderErrors.length || renderer.getContext().getError()) throw new Error(`Shader/WebGL error: ${shaderErrors.join('\n')}`)
        let maxRelativeError = 0, peak = 0, nightRadiance = 0
        for (let view = 0; view < 2; view++) {
          for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 3; channel++) {
              const actual = pixels[((view * 2) * width + x) * 4 + channel]
              const expected = pixels[((view * 2 + 1) * width + x) * 4 + channel]
              if (!Number.isFinite(actual) || actual < -1e-6 || !Number.isFinite(expected)) {
                throw new Error(`${name}: invalid radiance at view=${view}, x=${x}: ${actual}, ${expected}`)
              }
              peak = Math.max(peak, expected)
              if (x === 0) nightRadiance = Math.max(nightRadiance, actual)
              const error = Math.abs(actual - expected) / Math.max(expected, 1e-5)
              maxRelativeError = Math.max(maxRelativeError, error)
            }
          }
        }
        if (peak < 1e-3) throw new Error(`${name}: empty LUT or unrendered probe`)
        if (maxRelativeError > 0.02) throw new Error(`${name}: radiance to boundary differs from sky by ${(maxRelativeError * 100).toFixed(2)}% (limit 2%)`)
        if (nightRadiance > 1e-5) throw new Error(`${name}: unlit atmosphere glows: ${nightRadiance}`)
        // Проверяем и короткие сегменты у грунта на закате: здесь вычитаются
        // близкие LUT-сэмплы, а старый hack скрывал весь вклад Ми при mu_s < 0.
        for (const fraction of [0.001, 0.01, 0.25, 0.75]) {
          material.uniforms.segmentFraction.value = fraction
          renderer.render(scene, camera)
          renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
          for (let view = 0; view < 2; view++) {
            for (let x = 0; x < width; x++) {
              for (let channel = 0; channel < 3; channel++) {
                const partial = pixels[((view * 2) * width + x) * 4 + channel]
                const full = pixels[((view * 2 + 1) * width + x) * 4 + channel]
                const tolerance = Math.max(1e-5, full * 0.02)
                if (!Number.isFinite(partial) || partial < -tolerance || partial > full + tolerance) {
                  throw new Error(`${name}: invalid partial ray at fraction=${fraction}, view=${view}, x=${x}: ${partial} / ${full}`)
                }
              }
            }
          }
        }
        results.push({ name, maxRelativeError, nightRadiance })
      } finally {
        scene.remove(quad)
        material.dispose()
      }
    }
    return results
  } finally {
    generator.dispose()
    geometry.dispose()
    target.dispose()
    renderer.dispose()
  }
}
