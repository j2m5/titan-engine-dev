import {
  Camera, Color, Data3DTexture, DataUtils, FloatType, GLSL3, HalfFloatType, Mesh,
  Matrix4, NoBlending, PerspectiveCamera, PlaneGeometry, RGFormat, Scene, ShaderMaterial,
  type Texture, Uniform, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams, type NebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { nebulaNoiseChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaNoise'
import { nebulaDensityChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaDensity'
import { nebulaColorChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaColor'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'
import { checkNebulaLodComposition } from './rendering.gpu'

export function checkNebulaLightingLod(): ReturnType<typeof checkNebulaLodComposition> {
  return checkNebulaLodComposition({
    noise: { octaves: 2, warpStrength: 0, worleyStrength: 0 },
    lighting: { starPosition: new Vector3(0.2, 0.4, -2), anisotropy: 0.4, shadowStrength: 1 }
  })
}

function constantMedium(): Data3DTexture {
  const texture = new Data3DTexture(Float32Array.from({ length: 16 }, (_, i) => i % 2 ? 0.7 : 0.4), 2, 2, 2)
  texture.format = RGFormat
  texture.type = FloatType
  texture.needsUpdate = true
  return texture
}

function capture(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget): Float32Array {
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)
  const half = new Uint16Array(target.width * target.height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, half)
  renderer.setRenderTarget(null)
  if (renderer.getContext().getError()) throw new Error('Light transport: WebGL capture error')
  const pixels = Float32Array.from(half, value => DataUtils.fromHalfFloat(value))
  if (pixels.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Light transport: invalid HDR output')
  return pixels
}

/** Analytical phase response and Beer–Lambert light paths using production GLSL. */
export function checkNebulaLightTransport(): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
  const scene = new Scene(), camera = new Camera(), texture = constantMedium()
  const source = new NebulaRaymarchMaterial(mergeNebulaParams())
  source.setBakedDensityTexture(texture)
  const material = new ShaderMaterial({
    glslVersion: GLSL3, defines: { NEB_BAKED: '' }, blending: NoBlending,
    uniforms: { ...source.uniforms, uPoint: new Uniform(new Vector3()), uRay: new Uniform(new Vector3(0, 0, 1)) },
    vertexShader: 'void main() { gl_Position = vec4(position,1.0); }',
    fragmentShader: `
      precision highp float;
      precision highp sampler3D;
      out vec4 fragColor;
      ${noiseFunctions}
      ${nebulaNoiseChunk}
      ${nebulaDensityChunk}
      ${nebulaColorChunk}
      uniform vec3 uPoint;
      uniform vec3 uRay;
      void main() { fragColor = vec4(nebulaStarLight(uPoint,uRay),0.0,0.0,1.0); }
    `
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  scene.add(mesh)
  const measured: Record<string, number> = {}
  const check = (name: string, expected: number): void => {
    const actual = capture(renderer, scene, camera, target)[0]
    measured[name] = actual
    if (Math.abs(actual - expected) > Math.max(0.00005, expected * 0.0015)) {
      throw new Error(`Light transport ${name}: expected ${expected}, got ${actual}`)
    }
  }
  try {
    for (const g of [null, -0.9, -0.6, 0, 0.6, 0.9]) for (const cosine of [-1, -0.5, 0, 0.5, 1]) {
      source.setUniformsFromParams(mergeNebulaParams({ lighting: { starPosition: new Vector3(0, 0, 2), anisotropy: g, scatterStrength: 0.75 } }))
      material.uniforms.uStarLocal.value.set(0, 0, 2)
      material.uniforms.uRay.value.set(Math.sqrt(1 - cosine * cosine), 0, cosine)
      const phase = g === null ? Math.max(-cosine, 0) : (1 - g * g) / (1 + g * g - 2 * g * cosine) ** 1.5
      check(`phase/${g}/${cosine}`, 0.75 * phase)
    }
    const paths = [
      { name: 'outside axis', point: [0, 0, 0], star: [0, 0, 20], length: 1 },
      { name: 'inside', point: [0, 0, 0], star: [0, 0, 0.4], length: 0.4 },
      { name: 'coincident', point: [0, 0, 0], star: [0, 0, 0], length: 0 },
      { name: 'diagonal', point: [0, 0, 0], star: [-2, 2, -2], length: Math.sqrt(3) },
      { name: 'face inward', point: [1, 0, 0], star: [-2, 0, 0], length: 2 },
      { name: 'face outward', point: [1, 0, 0], star: [2, 0, 0], length: 0 },
      { name: 'face tangent', point: [1, 0, 0], star: [1, 4, 0], length: 1 },
      { name: 'off center', point: [0.4, 0.1, -0.3], star: [0.4, 0.1, 3], length: 1.3 }
    ]
    for (const path of paths) for (const steps of [1, 6, 16]) {
      const star = new Vector3(...path.star), point = new Vector3(...path.point)
      source.setUniformsFromParams(mergeNebulaParams({ density: 1.5, gas: { absorption: 0.4 }, dust: { strength: 0.8 },
        lighting: { starPosition: star, anisotropy: 0, shadowStrength: 1, scatterStrength: 0.75 }, quality: { lightSteps: steps } }))
      material.uniforms.uPoint.value.copy(point)
      material.uniforms.uStarLocal.value.copy(star)
      check(`path/${path.name}/${steps}`, 0.75 * Math.exp(-(0.4 * 1.5 * 0.4 + 0.7 * 0.8) * path.length))
    }
    for (const [name, gas, absorption, dust, strength] of [
      ['gas', 2, 0.6, 0, 1], ['dust', 0, 1, 2, 1], ['emission', 2, 0, 0, 1],
      ['empty', 0, 1, 0, 1], ['disabled', 2, 1, 2, 0], ['half', 2, 1, 2, 0.5], ['opaque', 100, 1, 100, 1]
    ] as const) {
      source.setUniformsFromParams(mergeNebulaParams({ density: gas, gas: { absorption }, dust: { strength: dust },
        lighting: { starPosition: new Vector3(0, 0, 2), anisotropy: 0, shadowStrength: strength, scatterStrength: 0.75, falloffRadius: 2 } }))
      material.uniforms.uPoint.value.set(0, 0, 0)
      material.uniforms.uStarLocal.value.set(0, 0, 2)
      check(`medium/${name}`, 0.375 * Math.exp(-(0.4 * gas * absorption + 0.7 * dust) * strength))
    }
    for (const lighting of [{ starPosition: null }, { starPosition: new Vector3(), scatterStrength: 0 }]) {
      source.setUniformsFromParams(mergeNebulaParams({ lighting: { anisotropy: 0.9, shadowStrength: 1, ...lighting } }))
      check(`disabled/${lighting.starPosition === null ? 'no star' : 'no scatter'}`, 0)
    }
    return measured
  } finally {
    mesh.geometry.dispose()
    material.dispose()
    source.dispose()
    texture.dispose()
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

function relativeError(a: Float32Array, b: Float32Array, alpha = false): number {
  let signal = 0, delta = 0
  for (let i = 0; i < a.length; i++) if (alpha ? i % 4 === 3 : i % 4 !== 3) {
    signal += a[i]
    delta += Math.abs(a[i] - b[i])
  }
  return delta / Math.max(signal, 1e-8)
}

/** Rendered radiance invariants plus live/baked field and translated-light agreement. */
export function checkNebulaLightingImages(): Record<string, number> {
  const size = 48, renderer = new WebGLRenderer()
  renderer.setSize(size, size)
  renderer.setClearColor(0, 0)
  const target = new WebGLRenderTarget(size, size, { type: HalfFloatType })
  const scene = new Scene(), camera = new PerspectiveCamera(50, 1, 0.01, 100)
  camera.position.set(0.1, 0.2, 3)
  camera.lookAt(0, 0, 0)
  camera.layers.enable(DEPTH_VOLUME_LAYER)
  const baker = new NebulaDensityBaker(renderer, 128)
  const base = mergeNebulaParams({
    seed: 42, density: 3, gas: { absorption: 0.5 }, axisRatios: new Vector3(1, 1, 1),
    noise: { octaves: 3, worleyStrength: 0, boundaryWarp: 0.15 },
    dust: { seed: 19, strength: 2, threshold: 0.3, color: new Color(0.3, 0.5, 0.7) },
    lighting: { starPosition: new Vector3(0.2, 0.4, -2), scatterStrength: 1.2, ambient: 0.3, anisotropy: 0.4, shadowStrength: 1 },
    quality: { maxSteps: 64, lightSteps: 8 }
  })
  const render = (params: NebulaParams, texture: Texture | null = null, transform = new Matrix4()): Float32Array => {
    const volume = new NebulaVolume(params)
    volume.material.setBakedDensityTexture(texture)
    volume.applyMatrix4(transform)
    scene.add(volume)
    const cameraPosition = camera.position.clone(), cameraRotation = camera.quaternion.clone(), cameraScale = camera.scale.clone()
    camera.applyMatrix4(transform)
    try { return capture(renderer, scene, camera, target) }
    finally {
      camera.position.copy(cameraPosition)
      camera.quaternion.copy(cameraRotation)
      camera.scale.copy(cameraScale)
      scene.remove(volume)
      volume.dispose()
      volume.geometry.dispose()
      volume.material.dispose()
    }
  }
  try {
    const texture = baker.bake(base)
    const shadowed = render(base, texture)
    const unshadowed = render(mergeNebulaParams({ lighting: { shadowStrength: 0 } }, base), texture)
    const alphaError = relativeError(shadowed, unshadowed, true)
    const shadowDifference = relativeError(unshadowed, shadowed)
    let brighterPixels = 0
    for (let i = 0; i < shadowed.length; i++) if (i % 4 !== 3 && shadowed[i] > unshadowed[i] + 0.001) brighterPixels++
    const dark = mergeNebulaParams({ lighting: { scatterStrength: 0 } }, base)
    const noStar = mergeNebulaParams({ lighting: { starPosition: null } }, base)
    const emissionError = Math.max(...[dark, noStar].map(params => relativeError(render(params, texture), render(mergeNebulaParams({ lighting: { shadowStrength: 0, anisotropy: null } }, params), texture))))
    const live = render(mergeNebulaParams({ quality: { bake3DTexture: false } }, base))
    const fallbackError = relativeError(live, render(base))
    const bakeError = relativeError(live, shadowed)
    const translation = new Matrix4().makeTranslation(1e10, -1e10, 1e10)
    const rotatedScaled = new Matrix4().makeRotationAxis(new Vector3(1, 2, 3).normalize(), 0.7).scale(new Vector3(4, 4, 4))
    const transformedError = (transform: Matrix4): number => relativeError(shadowed, render(mergeNebulaParams({
      lighting: { starPosition: base.lighting.starPosition!.clone().applyMatrix4(transform) }
    }, base), texture, transform))
    const translationError = transformedError(translation)
    const rotationScaleError = transformedError(rotatedScaled)
    const result = { alphaError, shadowDifference, brighterPixels, emissionError, fallbackError, bakeError, translationError, rotationScaleError }
    if (alphaError !== 0 || shadowDifference < 0.03 || brighterPixels || emissionError !== 0 || fallbackError !== 0 || bakeError > 0.025 || translationError > 0.001 || rotationScaleError > 0.001) {
      throw new Error(`Nebula lighting image mismatch: ${JSON.stringify(result)}`)
    }
    return result
  } finally {
    baker.dispose()
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
