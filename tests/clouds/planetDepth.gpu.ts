import { CloudsEffect } from '@takram/three-clouds'
import {
  Camera,
  FloatType,
  GLSL3,
  Mesh,
  NoBlending,
  PerspectiveCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { createJupiterAtmosphere, createJupiterClouds } from '@/labs/jupiter-clouds/JupiterCloudAdapter'

/** Exercise the actual cloud shader's depth consumer in float32, not a JS copy of its formula. */
export function checkPlanetDepth(adapted = true): Array<{ distance: number; actual: number; error: number }> {
  const renderer = new WebGLRenderer()
  const { atmosphere } = createJupiterAtmosphere()
  const clouds = adapted ? createJupiterClouds(new PerspectiveCamera(), atmosphere) : new CloudsEffect()
  const source = clouds.cloudsPass.currentMaterial.fragmentShader
  const extract = (name: string): string => {
    const match = source.match(new RegExp(`float ${name}\\([^]*?\\n\\}`))
    if (!match) throw new Error(`Depth shader function missing: ${name}`)
    return match[0]
  }
  const geometry = new PlaneGeometry(2, 2)
  const target = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false })
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: { encodedDepth: { value: 0 } },
    vertexShader: 'precision highp float; in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      precision highp float;
      #define PERSPECTIVE_CAMERA 1
      #define USE_LOGARITHMIC_DEPTH_BUFFER 1
      #include <packing>
      uniform float encodedDepth;
      uniform sampler2D depthBuffer;
      const float cameraNear = 10.0;
      const float cameraFar = 500000000.0;
      const vec2 vUv = vec2(0.5), targetUvScale = vec2(1.0), temporalJitter = vec2(0.0);
      const vec3 vCameraDirection = vec3(0.0, 0.0, -1.0);
      float readDepthValue(sampler2D unusedTexture, vec2 unusedUv) { return encodedDepth; }
      ${extract('reverseLogDepth')}
      ${extract('getViewZ')}
      ${adapted ? extract('planetViewZ') : ''}
      ${extract('getRayDistanceToScene')}
      out vec4 result;
      void main() { float viewZ; result = vec4(getRayDistanceToScene(vCameraDirection, viewZ), 0.0, 0.0, 1.0); }
    `
  })
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const pixels = new Float32Array(4)
  const results = []
  try {
    for (const distance of [90000000, 130000000, 1000, 20000, 45000]) {
      material.uniforms.encodedDepth.value = Math.log2(distance + 1) / Math.log2(500000001)
      renderer.setRenderTarget(target)
      renderer.render(scene, new Camera())
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixels)
      const actual = pixels[0]
      const error = Math.abs(actual - distance)
      results.push({ distance, actual, error })
      if (!Number.isFinite(actual) || error > Math.max(0.1, distance * 2e-5)) {
        throw new Error(`Depth ${distance} m decoded as ${actual} m (error ${error} m)`)
      }
    }
    if (renderer.getContext().getError()) throw new Error('Depth check produced a WebGL error')
    return results
  } finally {
    target.dispose()
    material.dispose()
    geometry.dispose()
    clouds.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
