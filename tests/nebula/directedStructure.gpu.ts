import {
  Camera, DataUtils, GLSL3, HalfFloatType, Matrix3, Mesh, NoBlending, PlaneGeometry,
  Scene, ShaderMaterial, type Texture, Uniform, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams, type NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { createNebulaUniforms } from '@/core/renderables/Nebula/material/shader/raymarch.template'
import { applyDensityUniforms } from '@/core/renderables/Nebula/material/densityUniforms'
import { nebulaNoiseChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaNoise'
import { nebulaDensityChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaDensity'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'

const SIZE = 128

function projection(direction: Vector3, stretch: number): Matrix3 {
  // Independent linear-algebra reference: I + (1/s - 1) outer(d,d).
  const d = direction.clone().normalize(), k = 1 / stretch - 1
  return new Matrix3().set(
    1 + k * d.x * d.x, k * d.x * d.y, k * d.x * d.z,
    k * d.y * d.x, 1 + k * d.y * d.y, k * d.y * d.z,
    k * d.z * d.x, k * d.z * d.y, 1 + k * d.z * d.z
  )
}

function relativeError(reference: Float32Array, actual: Float32Array): number {
  let signal = 0, delta = 0
  for (let i = 0; i < reference.length; i += 4) for (const channel of [0, 1]) {
    signal += reference[i + channel]
    delta += Math.abs(reference[i + channel] - actual[i + channel])
  }
  if (signal < 1) throw new Error('Empty directed-structure reference field')
  return delta / signal
}

function gradientRatio(pixels: Float32Array, channel: number): number {
  let dx = 0, dy = 0
  for (let y = 0; y < SIZE - 1; y++) for (let x = 0; x < SIZE - 1; x++) {
    const i = (y * SIZE + x) * 4 + channel
    dx += Math.abs(pixels[i + 4] - pixels[i])
    dy += Math.abs(pixels[i + SIZE * 4] - pixels[i])
  }
  return dy / Math.max(dx, 1e-8)
}

/** Production field slices test directionality without camera/projection ambiguity. */
export function checkNebulaDirectedStructure(): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  const scene = new Scene(), camera = new Camera()
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: HalfFloatType })
  const material = new ShaderMaterial({
    glslVersion: GLSL3, defines: { NEB_BAKED: '' }, blending: NoBlending,
    uniforms: {
      ...createNebulaUniforms(), uDensityTex: new Uniform<Texture | null>(null), uDensityReady: new Uniform(0),
      uSampleTransform: new Uniform(new Matrix3()), uExtent: new Uniform(0.5), uZ: new Uniform(0.13)
    },
    vertexShader: 'void main() { gl_Position = vec4(position,1.0); }',
    fragmentShader: `
      precision highp float;
      precision highp sampler3D;
      out vec4 fragColor;
      ${noiseFunctions}
      ${nebulaNoiseChunk}
      ${nebulaDensityChunk}
      uniform mat3 uSampleTransform;
      uniform float uExtent;
      uniform float uZ;
      void main() {
        vec3 p = uSampleTransform * vec3((gl_FragCoord.xy / ${SIZE}.0 * 2.0 - 1.0) * uExtent,uZ);
        fragColor = vec4(nebulaMedium(p),0.0,1.0);
      }
    `
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  scene.add(mesh)
  const baker = new NebulaDensityBaker(renderer, SIZE)
  const render = (params: NebulaParams, transform = new Matrix3(), texture: Texture | null = null): Float32Array => {
    applyDensityUniforms(material.uniforms, params)
    material.uniforms.uSampleTransform.value.copy(transform)
    material.uniforms.uDensityTex.value = texture
    material.uniforms.uDensityReady.value = texture ? 1 : 0
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const half = new Uint16Array(SIZE * SIZE * 4)
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, half)
    if (renderer.getContext().getError()) throw new Error('Directed-structure GPU readback failed')
    const result = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
    if (result.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Invalid directed field value')
    renderer.setRenderTarget(null)
    return result
  }
  const base = mergeNebulaParams({
    seed: 42, axisRatios: new Vector3(3, 3, 3),
    noise: { octaves: 3, frequency: 2.2, warpStrength: 0.4, worleyStrength: 0.5, contrast: 1.5 },
    dust: { seed: 19, frequency: 2.2, threshold: 0.5, contrast: 1.1 }
  })
  try {
    const isotropic = render(base)
    const identityError = relativeError(isotropic, render(mergeNebulaParams({ structure: { direction: new Vector3(1, 2, 3) } }, base)))
    let transformError = 0, signError = 0
    for (const direction of [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(1, 2, -0.3)]) {
      const params = mergeNebulaParams({ structure: { direction, stretch: 6 } }, base)
      const directed = render(params)
      transformError = Math.max(transformError, relativeError(render(base, projection(direction, 6)), directed))
      signError = Math.max(signError, relativeError(directed, render(mergeNebulaParams({ structure: { direction: direction.clone().negate() } }, params))))
    }
    const vertical = render(mergeNebulaParams({ structure: { stretch: 6 } }, base))
    const gasRatio = gradientRatio(vertical, 0), dustRatio = gradientRatio(vertical, 1)
    const gasRatioBefore = gradientRatio(isotropic, 0), dustRatioBefore = gradientRatio(isotropic, 1)

    const bakeParams = mergeNebulaParams({
      axisRatios: new Vector3(1, 0.8, 1), structure: { direction: new Vector3(1, 2, -0.3), stretch: 5 },
      noise: { boundaryWarp: 0.3 },
      lobes: [{ center: new Vector3(0.3, 0.2, 0), radius: 0.2, weight: 0.4 }],
      cavities: [{ center: new Vector3(-0.2, 0, 0), radius: 0.3, strength: 0.8 }]
    }, base)
    material.uniforms.uExtent.value = 1
    material.uniforms.uZ.value = 1 / SIZE // centre of slice SIZE/2
    const live = render(bakeParams)
    const baked = render(bakeParams, new Matrix3(), baker.bake(bakeParams))
    let bakeError = 0
    for (let i = 0; i < live.length; i += 4) for (const channel of [0, 1]) bakeError = Math.max(bakeError, Math.abs(live[i + channel] - baked[i + channel]))
    const result = { identityError, signError, transformError, gasRatio, dustRatio, gasRatioBefore, dustRatioBefore, bakeError }
    if (identityError !== 0 || signError !== 0 || transformError > 0.002 || gasRatio > gasRatioBefore * 0.5 || dustRatio > dustRatioBefore * 0.5 || bakeError > 0.0045) {
      throw new Error(`Directed structure mismatch: ${JSON.stringify(result)}`)
    }
    return result
  } finally {
    renderer.setRenderTarget(null)
    baker.dispose(); target.dispose(); material.dispose(); mesh.geometry.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
