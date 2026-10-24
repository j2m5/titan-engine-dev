import {
  CubeTexture,
  DataTexture,
  FloatType,
  GLSL3,
  Mesh,
  NearestFilter,
  NoBlending,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  UniformsUtils,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { RenderingObjects } from '@storage/database'
import { SpaceScale } from '@/core/constants'
import type { BackgroundSource } from '@/config/background'
import { captureAtmosphereFrame } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import {
  buildSkySampleFunctions,
  buildSkySampleUniforms,
  createSkyUniforms
} from '@/core/materials/shaders/lib/chunks/SkySample'
import { FakeStarShaderTemplate } from '@/core/materials/shaders/lib/FakeStarShaderTemplate'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { atmosphereSkyVisibility, skyAtmosphereUniforms } from '@/core/sky/atmosphereSkyVisibility'

/**
 * Browser GPU regression, without external sky assets:
 * await import('/tests/atmosphere/skyVisibility.gpu.ts').then(m => m.checkAtmosphereSkyVisibility())
 */
export function checkAtmosphereSkyVisibility(): Array<{ source: BackgroundSource; pose: string; visibility: number }> {
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  const target = new WebGLRenderTarget(16, 16, { type: FloatType })
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e8)
  const earth = RenderingObjects.find((row) => row.actorId === 47)!.data as unknown as AtmosphereConfig
  const planet = new Object3D()
  planet.position.set(1e6 * SpaceScale, 0, 0)
  scene.add(planet)
  const registry = new AtmosphereRegistry()
  const faces = Array.from(
    { length: 6 },
    () => new DataTexture(new Float32Array([1, 0.75, 0.5, 1]), 1, 1, RGBAFormat, FloatType)
  )
  const cube = new CubeTexture(faces)
  cube.type = FloatType
  cube.minFilter = cube.magFilter = NearestFilter
  cube.generateMipmaps = false
  cube.needsUpdate = true
  const entry = {
    actorId: 47,
    generation: 0,
    ready: true,
    name: 'Earth',
    object: planet,
    config: earth,
    // This probe exercises background sampling; atmosphere LUTs are not sampled here.
    lut: { transmittance: cube, scattering: cube, irradiance: cube }
  }
  registry.register(entry)
  const visibility = skyAtmosphereUniforms.uSkyAtmosphereVisibility
  const previousVisibility = visibility.value
  const errors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    errors.push(
      gl.getProgramInfoLog(program) ?? '',
      gl.getShaderInfoLog(vertex) ?? '',
      gl.getShaderInfoLog(fragment) ?? ''
    )
  }
  const starMaterial = new ShaderMaterial({
    vertexShader: FakeStarShaderTemplate.vertexShader,
    fragmentShader: FakeStarShaderTemplate.fragmentShader,
    uniforms: UniformsUtils.clone(FakeStarShaderTemplate.uniforms),
    transparent: true,
    depthTest: true,
    depthWrite: false
  })
  const star = new Mesh(geometry, starMaterial)
  // Resolve an opaque core at 16×16; an antialiased edge legitimately includes
  // transmitted background and therefore changes when that background fades.
  star.scale.setScalar(30)
  star.visible = false
  scene.add(star)
  const pixels = new Float32Array(4)
  const draw = (): number[] => {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 8, 8, 1, 1, pixels)
    if (errors.length || renderer.getContext().getError()) throw new Error(`Shader/WebGL failure: ${errors.join('\n')}`)
    if (pixels.some((v) => !Number.isFinite(v))) throw new Error('Non-finite sky sample')
    return Array.from(pixels.slice(0, 3))
  }
  const assertClose = (a: number[], b: number[], label: string): void => {
    if (a.some((v, channel) => Math.abs(v - b[channel]) > 1e-4)) {
      throw new Error(`${label}: ${a} != ${b}`)
    }
  }
  const results: Array<{ source: BackgroundSource; pose: string; visibility: number }> = []
  try {
    for (const source of ['gaia', 'cubemap'] as const) {
      const uniforms = {
        ...createSkyUniforms(source),
        skybox: new Uniform(cube),
        uGaiaGalaxy: new Uniform(cube),
        uGaiaStars: new Uniform(cube),
        uGaiaStarsCoarse: new Uniform(cube),
        uGaiaMinLod: new Uniform(7),
        uProbeLensed: new Uniform(false)
      }
      const material = new RawShaderMaterial({
        glslVersion: GLSL3,
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
        uniforms,
        vertexShader: `precision highp float; in vec3 position; out vec2 vUv;
          void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `precision highp float;
          uniform samplerCube skybox;
          uniform bool uProbeLensed;
          ${buildSkySampleUniforms(source)}
          ${buildSkySampleFunctions(source)}
          in vec2 vUv; out vec4 fragColor;
          void main() {
            vec3 dir = normalize(vec3(vUv * 2.0 - 1.0, -1.0));
            vec3 dx = dFdx(dir), dy = dFdy(dir);
            fragColor = vec4(uProbeLensed ? sampleSkyLensed(dir, dx, dy, dx, dy) : sampleSky(dir, dx, dy), 1.0);
          }`
      })
      const quad = new Mesh(geometry, material)
      quad.frustumCulled = false
      quad.renderOrder = -1000
      scene.add(quad)
      try {
        for (const [pose, altitude, sunCosine] of [
          ['day-ground', 0.01, 1],
          ['day-low', 5, 1],
          ['night-ground', 0.01, -1],
          ['day-upper', 40, 1],
          ['orbit', 1000, 1]
        ] as const) {
          const radius = earth.bottomRadius + altitude
          camera.position.copy(planet.position)
          camera.position.x -= radius * sunCosine * SpaceScale
          camera.updateMatrixWorld(true)
          planet.updateMatrixWorld(true)
          const gain = atmosphereSkyVisibility(captureAtmosphereFrame(camera, registry, 1))
          visibility.value = 1
          const baseline = draw()
          if (baseline[0] < 0.01) throw new Error(`${source}: fixture sky was not drawn`)
          visibility.value = gain
          const actual = draw()
          const hidden = pose === 'day-ground' || pose === 'day-low'
          assertClose(actual, hidden ? [0, 0, 0] : baseline, `${source}/${pose}`)
          uniforms.uProbeLensed.value = true
          assertClose(draw(), actual, `${source}/${pose}/lensed`)
          uniforms.uProbeLensed.value = false
          results.push({ source, pose, visibility: gain })
        }
        // The actual far-star shader does not write depth, like the Sun's LOD.
        // Background compensation must not remove its radiance.
        star.position.copy(camera.position)
        star.position.z -= 100
        star.visible = true
        visibility.value = 1
        const sunBefore = draw()
        if (sunBefore[0] < 1) throw new Error('Sun impostor fixture was not drawn')
        visibility.value = 0
        assertClose(draw(), sunBefore, `${source}/sun-impostor`)
        star.visible = false
      } finally {
        scene.remove(quad)
        material.dispose()
      }
    }
    return results
  } finally {
    visibility.value = previousVisibility
    starMaterial.dispose()
    geometry.dispose()
    cube.dispose()
    faces.forEach((face) => face.dispose())
    target.dispose()
    renderer.dispose()
  }
}
