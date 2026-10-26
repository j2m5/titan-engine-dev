import {
  AddEquation, BackSide, CustomBlending, DataTexture, FloatType, Group, Mesh,
  OneFactor, OneMinusSrcAlphaFactor, PerspectiveCamera, RGBAFormat, ShaderMaterial,
  SphereGeometry, Vector2, Vector4, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { DEPTH_VOLUME_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'
import { drawDepthVolumes, orderFarToNear } from '@/core/graphic/passes/DepthVolumePass'

class SolidVolume extends Mesh<SphereGeometry, ShaderMaterial> implements DepthVolume {
  constructor(name: string, readonly boundingRadius: number, color: Vector4) {
    super(new SphereGeometry(boundingRadius, 16, 8), new ShaderMaterial({
      uniforms: { color: { value: color } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec4 color; void main() { gl_FragColor = color; }',
      side: BackSide, transparent: true, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendEquation: AddEquation,
      blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      blendEquationAlpha: AddEquation, blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor
    }))
    this.name = name
    this.layers.set(DEPTH_VOLUME_LAYER)
  }
  bindSceneDepth(): void {}
  unbindSceneDepth(): void {}
}

/** Reflection must not change the order-sensitive blend of symmetric proxies. */
export function checkVolumeReflectionOrder(): object {
  const size = 16, resolution = new Vector2(size, size)
  const renderer = new WebGLRenderer()
  renderer.setSize(size, size)
  renderer.setClearColor(0, 0)
  renderer.autoClear = false
  const target = new WebGLRenderTarget(size, size, { type: FloatType, depthBuffer: false })
  const sceneDepth = new DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, RGBAFormat, FloatType)
  sceneDepth.needsUpdate = true
  const outer = new SolidVolume('outer', 1, new Vector4(0.5, 0, 0, 0.5))
  const middle = new SolidVolume('middle', 2.5, new Vector4(0, 0.5, 0, 0.5))
  const inner = new SolidVolume('inner', 0.5, new Vector4(0, 0, 0.5, 0.5))
  const parent = new Group(), camera = new PerspectiveCamera(50, 1, 0.01, 100)
  parent.position.set(8, -7, 11)
  parent.rotation.set(0.2, -0.6, 0.1)
  parent.add(outer, middle, inner)
  // Red, then green, then blue, each premultiplied at alpha 1/2 over transparent black.
  const expectedPixel = [0.125, 0.25, 0.5, 0.875]
  const pixels = new Float32Array(size * size * 4)
  const results: { mode: string; signs: number[]; order: string[]; mismatchedComponents: number; firstPixel: number[] }[] = []
  const shaderErrors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment): void => {
    shaderErrors.push(gl.getProgramInfoLog(program) ?? '', gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
  }
  try {
    for (const mode of ['direct', 'parent']) for (let mask = 0; mask < 8; mask++) {
      const x = mask & 1 ? -1 : 1, y = mask & 2 ? -1 : 1, z = mask & 4 ? -1 : 1
      outer.scale.set(mode === 'direct' ? 4 * x : 4, mode === 'direct' ? y : 1, mode === 'direct' ? z : 1)
      parent.scale.set(mode === 'parent' ? x : 1, mode === 'parent' ? y : 1, mode === 'parent' ? z : 1)
      parent.updateMatrixWorld(true)
      parent.getWorldPosition(camera.position)
      camera.updateMatrixWorld(true)
      const ordered = orderFarToNear([inner, middle, outer], camera)
      renderer.setRenderTarget(target)
      renderer.clear()
      drawDepthVolumes(renderer, target, camera, ordered, sceneDepth, resolution)
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)
      const glError = renderer.getContext().getError()
      if (glError || shaderErrors.length) throw new Error(`Volume order WebGL ${glError}: ${shaderErrors.join('\n')}`)
      let mismatchedComponents = 0
      for (let i = 0; i < pixels.length; i++) if (pixels[i] !== expectedPixel[i % 4]) mismatchedComponents++
      results.push({ mode, signs: [x, y, z], order: ordered.map(volume => volume.name), mismatchedComponents, firstPixel: Array.from(pixels.subarray(0, 4)) })
    }
    const failures = results.filter(result => result.mismatchedComponents || result.order.join(',') !== 'outer,middle,inner')
    if (failures.length) throw Object.assign(new Error(`Reflected volume blend mismatch: ${JSON.stringify(failures)}`), { results })
    return { expectedPixel, results }
  } finally {
    for (const volume of [outer, middle, inner]) { volume.geometry.dispose(); volume.material.dispose() }
    sceneDepth.dispose()
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
