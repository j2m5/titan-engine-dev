import {
  FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  Uniform, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { terrainNearShadowFunctions } from '@/core/materials/shaders/lib/chunks/TerrainNearShadow'
import { terrainShadowMarchUniforms } from '@/core/materials/shaders/lib/chunks/TerrainShadowMarch'
import { Actor } from '@/core/models/Actor'
import { NearShadowTile } from '@/core/terrain/NearShadowTile'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'

/** Exercise the production texture, material binding and GLSL with real WebGL readback. */
export function checkNearShadowFiltering(disableFloatLinear: boolean) {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')!
  if (!gl) throw new Error('WebGL2 is required')
  if (disableFloatLinear) {
    // Withhold the extension before Three initializes it, so GL itself rejects LINEAR R32F.
    const getExtension = gl.getExtension.bind(gl)
    const getSupportedExtensions = gl.getSupportedExtensions.bind(gl)
    gl.getExtension = (name: string) => name === 'OES_texture_float_linear' ? null : getExtension(name)
    gl.getSupportedExtensions = () => getSupportedExtensions()?.filter(name => name !== 'OES_texture_float_linear') ?? null
  }
  const renderer = new WebGLRenderer({ canvas, context: gl })
  renderer.setSize(1, 1)
  const floatLinear = renderer.extensions.has('OES_texture_float_linear')
  const actor = Actor.find(19)!
  const field = new TerrainHeightField({
    width: 4, height: 2, minMeters: 0, maxMeters: 0, data: new Uint16Array(8)
  }, actor.physicalObject!.getAttribute('radius', 1))
  const heights = new Float32Array([
    -40, -20, 40, 80,
    -10, 10, 90, 170,
    0, 80, 240, 400,
    10, 100, 300, 800
  ])
  const tile = new NearShadowTile(field, {
    requestNearTile: (_field, params, onDone) => {
      if (params.texels !== 4) throw new Error('Probe requires a 4x4 tile')
      onDone(heights)
    }
  }, { ...config('terrain.nearShadow'), tileTexels: 4, texelMeters: 1 }, floatLinear)
  const state = tile.update(new Vector3(toThreeJSUnits(field.radiusKm + 1), 0, 0))!
  const terrain = new TerrainMaterial(actor)
  terrain.setNearTile(state)
  terrain.uniforms.uNearShadowMaxDistMeters.value = 2
  terrain.uniforms.uShadowPenumbraTan.value = 0.01
  const xy = new Vector2()
  const sun = new Vector3(1, 0, 0)
  const material = new ShaderMaterial({
    uniforms: { ...terrain.uniforms, uProbeXY: new Uniform(xy), uProbeSun: new Uniform(sun) },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${terrainShadowMarchUniforms}
      ${terrainNearShadowFunctions}
      uniform vec2 uProbeXY;
      uniform vec3 uProbeSun;
      void main() {
        gl_FragColor = vec4(terrainNearTileHeight(uProbeXY), terrainNearShadowMarch(vec3(1.0, 0.0, 0.0), uProbeSun), 0.0, 1.0);
      }`
  })
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const target = new WebGLRenderTarget(1, 1, {
    type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false
  })
  const results: { floatLinear: boolean; samples: unknown[]; shadows: unknown[] } = { floatLinear, samples: [], shadows: [] }
  const read = () => {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixel = new Float32Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw Object.assign(new Error(`Near shadow WebGL error: ${error}`), { results })
    return pixel
  }
  const assertClose = (actual: number, expected: number, context: string) => {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.002) {
      throw Object.assign(new Error(`${context}: expected ${expected}, got ${actual}`), { results })
    }
  }
  try {
    // Hand-derived bilinear values, including signed heights, fractional centers and all edges.
    for (const [x, y, expected] of [
      [-1.5, -1.5, -40], [-0.5, -0.5, 10], [0, 0, 105], [-1, -1, -15], [0.25, -0.25, 102.5],
      [-2, 0, -5], [2, 0, 285], [0, -2, 10], [0, 2, 200], [-100, -100, -40], [100, 100, 800]
    ]) {
      xy.set(x, y)
      const height = read()[0]
      results.samples.push({ x, y, expected, height })
      assertClose(height, expected, `Height at (${x}, ${y})`)
    }

    xy.set(0, 0)
    heights.fill(0)
    state.texture.needsUpdate = true
    for (const [name, direction, expected] of [
      ['flat ground', [0.1, 0, -1], 1],
      ['ridge towards sun', [0.1, 0, -1], 0],
      ['ridge away from sun', [0.1, 0, 1], 1],
      ['sun above ridge', [1, 0, -0.1], 1]
    ] as const) {
      if (name === 'ridge towards sun') {
        for (let y = 0; y < 4; y++) heights[y * 4 + 3] = 10
        state.texture.needsUpdate = true
      }
      sun.set(direction[0], direction[1], direction[2]).normalize()
      const shadow = read()[1]
      results.shadows.push({ name, expected, shadow })
      assertClose(shadow, expected, name)
    }
    return results
  } finally {
    target.dispose()
    geometry.dispose()
    material.dispose()
    terrain.dispose()
    tile.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
