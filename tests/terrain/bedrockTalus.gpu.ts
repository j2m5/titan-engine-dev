import {
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { bedrockTalusFunctions, bedrockTalusUniforms } from '@/core/materials/shaders/lib/chunks/TerrainBedrockTalus'
import { bedrockPhaseWarp } from '@/core/terrain/bedrockShape'
import { BedrockField } from '@/core/terrain/bedrockField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'

/** Real GLSL phase must follow CPU ledges, with coverage confined to their apron. */
export function checkBedrockTalus() {
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  const target = new WebGLRenderTarget(1, 1, {
    type: FloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false
  })
  const uniforms = {
    uBedrockShape: new Uniform(new Vector4(0.45, 800, 1, 3390000)),
    uBedrockWater: new Uniform(new Vector2()),
    uBedrockFade: new Uniform(new Vector2(1500, 4000)),
    uProbeDir: new Uniform(new Vector3()),
    uProbeHeight: new Uniform(0),
    uProbeSlope: new Uniform(0.7),
    uProbeDistance: new Uniform(0)
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: `${bedrockTalusUniforms}
      ${bedrockTalusFunctions}
      uniform vec3 uProbeDir; uniform float uProbeHeight, uProbeSlope, uProbeDistance;
      void main(){
        float phase=bedrockMaterialPhase(uProbeDir,uProbeHeight);
        gl_FragColor=vec4(phase, bedrockApron(phase), terrainBedrockTalus(uProbeDir,uProbeHeight,uProbeSlope,uProbeDistance),1.0);
      }`
  })
  const geometry = new PlaneGeometry(2, 2),
    scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  let checks = 0,
    maxError = 0
  const read = () => {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixel = new Float32Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    if (renderer.getContext().getError() !== 0 || pixel[3] !== 1) throw new Error('Talus shader did not render')
    return pixel
  }
  const check = (actual: number, expected: number, label: string) => {
    const error = Math.abs(actual - expected)
    maxError = Math.max(maxError, error)
    checks++
    if (!Number.isFinite(error) || error > 0.004) throw new Error(`${label}: ${actual} != ${expected}`)
  }
  const smooth = (lo: number, hi: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)
  }
  try {
    for (const weathering of [0, 0.35, 1]) {
      uniforms.uBedrockShape.value.z = weathering
      const field = new BedrockField(
        { ...MIDBAND_DEFAULTS, bedrockStrength: 0.45, bedrockWeathering: weathering },
        3390000
      )
      for (let i = 0; i < 30; i++) {
        const dir = uniforms.uProbeDir.value
          .set(Math.cos(i * 0.31), Math.sin(i * 0.47) * 0.9, Math.sin(i * 0.31))
          .normalize()
        const warp = bedrockPhaseWarp(dir.x, dir.y, dir.z, 3390000, weathering)
        for (const p of [0, 0.08, 0.15, 0.25, 0.36, 0.42, 0.6, 0.99]) {
          uniforms.uProbeHeight.value = (p + 3 - warp) * 800
          const pixel = read(),
            apron = smooth(0.08, 0.18, p) * (1 - smooth(0.34, 0.42, p))
          check(pixel[0], p + 3, 'phase')
          check(pixel[1], apron, 'apron')
          check(
            pixel[2],
            apron * weathering * field.envelope(0.7, uniforms.uProbeHeight.value, Math.hypot(dir.x, dir.z)),
            'coverage'
          )
        }
      }
    }
    uniforms.uBedrockShape.value.z = 1
    uniforms.uProbeDir.value.set(1, 0, 0)
    uniforms.uProbeHeight.value = (3.25 - bedrockPhaseWarp(1, 0, 0, 3390000, 1)) * 800
    check(read()[2], 1, 'full apron')
    uniforms.uProbeSlope.value = 0.1
    check(read()[2], 0, 'flat')
    uniforms.uProbeSlope.value = 0.7
    uniforms.uBedrockWater.value.set(uniforms.uProbeHeight.value, 1)
    check(read()[2], 0, 'shoreline')
    uniforms.uBedrockWater.value.y = 0
    uniforms.uProbeDistance.value = 4000
    check(read()[2], 0, 'far')
    uniforms.uProbeDistance.value = 0
    uniforms.uProbeSlope.value = 8
    check(read()[2], 0, 'unresolved steepness')
    uniforms.uProbeSlope.value = 0.7
    uniforms.uBedrockShape.value.x = 0
    check(read()[2], 0, 'disabled')
    return { checks, maxError }
  } finally {
    target.dispose()
    geometry.dispose()
    material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
