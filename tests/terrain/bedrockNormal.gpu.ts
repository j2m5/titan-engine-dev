import {
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { slopeNormalFunctions, slopeNormalUniforms } from '@/core/materials/shaders/lib/chunks/SlopeNormal'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'

/** The actual slope GLSL must not reverse a shelf when the DEM base is filtered. */
export function checkBedrockNormal() {
  const R = 3390000,
    width = 64,
    height = 512,
    minMeters = -100000,
    maxMeters = 100000
  const data = new Uint16Array(width * height),
    step = (Math.PI * R) / height
  for (let y = 0; y < height; y++) {
    const meters = 120 + Math.min(60000, Math.max(0, 255 - y) * 1.4 * step)
    data.fill(Math.round(((meters - minMeters) / (maxMeters - minMeters)) * 65535), y * width, (y + 1) * width)
  }
  const fresh = () => ({ heightMeters: 0, tiltE: 0, tiltN: 0, envelope: 0, octaveWeightSum: 0, mapSlopeScale: 0 })
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  const target = new WebGLRenderTarget(1, 1, {
    type: FloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false
  })
  const texture = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  const uniforms = {
    bumpMap: new Uniform(texture),
    bumpScale: new Uniform(1),
    uSlopeRange: new Uniform(2),
    uBase: new Uniform(new Vector3()),
    uEast: new Uniform(new Vector3()),
    uTilt: new Uniform(new Vector3()),
    uParent: new Uniform(new Vector3()),
    uMorph: new Uniform(0)
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform sampler2D bumpMap; uniform float bumpScale;
      uniform vec3 uBase,uEast,uTilt,uParent; uniform float uMorph;
      ${slopeNormalUniforms}\n${slopeNormalFunctions}
      void main(){vec2 decoded;gl_FragColor=vec4(perturbNormalFromSlope(uBase,uEast,vec2(0.5),mix(uTilt,uParent,uMorph),decoded),1.0);}`
  })
  const geometry = new PlaneGeometry(2, 2),
    scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  let checks = 0,
    maxError = 0
  const cases: string[] = []
  try {
    for (const [strength, bedrockWeathering] of [0, 0.45, 0.6, 1].flatMap((s) => [0, 1].map((w) => [s, w]))) {
      const field = new TerrainHeightField({ width, height, data, minMeters, maxMeters }, R / 1000, {
        ...MIDBAND_DEFAULTS,
        midbandStrength: 0,
        bedrockStrength: strength,
        bedrockWeathering
      })
      for (const meters of [1, 250, 500]) {
        const lat = (0.5 - 255.5 / height) * Math.PI + meters / R
        const d = new Vector3(Math.cos(lat), Math.sin(lat), 0),
          east = new Vector3(0, 1, 0).cross(d),
          north = d.clone().cross(east).normalize()
        const uv = field.dirToUv(d, new Vector2()),
          h = field.mapHeightMeters(d),
          child = fresh(),
          parent = fresh()
        field.midbandSample(
          d,
          uv.x,
          uv.y,
          h,
          child,
          field.vertexStepMeters(10),
          true,
          field.vertexStepMeters(9),
          parent,
          true
        )
        uniforms.uBase.value.copy(d)
        uniforms.uEast.value.copy(east)
        uniforms.uTilt.value.set(child.tiltE, child.tiltN, child.mapSlopeScale)
        uniforms.uParent.value.set(parent.tiltE, parent.tiltN, parent.mapSlopeScale)
        for (const baseSlope of [1.4, 0.7, 0.35, 0.07])
          for (const bump of [1, 0.2])
            for (const morph of [0, 0.5, 1]) {
              const texels = texture.image.data as Float32Array
              texels.set([128 / 255, (128 + (127 * baseSlope) / 2) / 255, 0, 1])
              texture.needsUpdate = true
              uniforms.bumpScale.value = bump
              uniforms.uMorph.value = morph
              renderer.setRenderTarget(target)
              renderer.render(scene, camera)
              const pixel = new Float32Array(4)
              renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
              const n = new Vector3().fromArray(pixel),
                expectedTilt = uniforms.uTilt.value.clone().lerp(uniforms.uParent.value, morph)
              const expected = d
                .clone()
                .addScaledVector(east.clone().normalize(), -expectedTilt.x)
                .addScaledVector(north, -(baseSlope * bump * (1 + expectedTilt.z) + expectedTilt.y))
                .normalize()
              const error = n.distanceTo(expected)
              maxError = Math.max(maxError, error)
              checks++
              if (!Number.isFinite(error) || error > 1e-5) throw new Error(`bedrock normal mismatch ${error}`)
              // At the start of the ascending cell the shelf remains uphill even with a strongly filtered base.
              if (expectedTilt.z < -1.000001) throw new Error('Bedrock reversed the DEM response')
              if (bedrockWeathering === 0 && meters === 1 && strength <= 0.6 && -n.dot(north) / n.dot(d) < -0.001) {
                throw new Error(
                  `bedrock shelf reversed: strength=${strength}, base=${baseSlope}, bump=${bump}, morph=${morph}`
                )
              }
            }
        cases.push(`strength ${strength}, weathering ${bedrockWeathering}, kink offset ${meters}`)
      }
    }
    if (renderer.getContext().getError() !== 0) throw new Error('Bedrock normal WebGL error')
    return { checks, maxError, cases }
  } finally {
    target.dispose()
    texture.dispose()
    geometry.dispose()
    material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
