import {
  Camera, Data3DTexture, FloatType, GLSL3, Mesh, NoBlending, PlaneGeometry,
  RGFormat, ShaderMaterial, Uniform, UnsignedByteType, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { nebulaLightingChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaLighting'

/** Catch skipped opaque cutoffs, stale texture classification, wrong sample positions
 * and optical bounds cached across dynamic uniform changes. Float32 preserves the
 * tiny nonzero exp(-tau) that must become exactly zero for an opaque light path. */
export function checkNebulaLightBound(): Record<string, number> {
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  const target = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false })
  const source = new NebulaRaymarchMaterial(mergeNebulaParams())
  const textures = [
    new Data3DTexture(new Uint8Array(16).fill(255), 2, 2, 2),
    new Data3DTexture(new Float32Array(16).fill(32), 2, 2, 2),
    new Data3DTexture(new Float32Array(16).fill(32), 2, 2, 2),
    // Two Z slabs: lower (gas .2, dust .6), upper (gas .8, dust .2).
    new Data3DTexture(Uint8Array.from({ length: 16 }, (_, i) => i < 8 ? (i % 2 ? 153 : 51) : (i % 2 ? 51 : 204)), 2, 2, 2)
  ]
  for (const texture of textures) {
    texture.format = RGFormat
    texture.type = texture.image.data instanceof Uint8Array ? UnsignedByteType : FloatType
    texture.needsUpdate = true
  }
  textures[2].internalFormat = 'RG16F'
  const material = new ShaderMaterial({
    glslVersion: GLSL3, defines: { NEB_BAKED_ONLY: '' }, blending: NoBlending,
    depthTest: false, depthWrite: false,
    uniforms: { ...source.uniforms, uPoint: new Uniform(new Vector3()), uStar: new Uniform(new Vector3(0, 0, 2)) },
    vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
    fragmentShader: `
      precision highp float;
      uniform highp sampler3D uDensityTex;
      vec2 nebulaMedium(vec3 p) { return textureLod(uDensityTex, p * 0.5 + 0.5, 0.0).rg; }
      ${nebulaLightingChunk}
      uniform vec3 uPoint;
      uniform vec3 uStar;
      out vec4 color;
      void main() {
        vec3 delta = uStar - uPoint;
        float distanceToStar = length(delta);
        color = vec4(nebulaLightTransmittance(uPoint, delta / max(distanceToStar, 1e-6), distanceToStar), 0.0, 0.0, 1.0);
      }
    `
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material), camera = new Camera()
  let cases = 0, opaqueCases = 0, maxError = 0
  const check = (name: string, expected: number, cutoffBoundary = false) => {
    renderer.setRenderTarget(target)
    renderer.render(mesh, camera)
    const pixels = new Float32Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixels)
    // At analytical tau12 the GPU's reciprocal/accumulation may land just below
    // the cutoff. Both 0 and exp(-12) are valid; neighboring cases remain strict.
    const actual = pixels[0], error = cutoffBoundary && actual === 0 ? 0 : Math.abs(actual - expected)
    if (!Number.isFinite(actual) || (expected === 0 ? actual !== 0 : error > Math.max(2e-8, expected * 2e-5))) {
      throw new Error(`Bounded light ${name}: expected ${expected}, got ${actual}`)
    }
    if (renderer.getContext().getError()) throw new Error(`Bounded light ${name}: GL error`)
    maxError = Math.max(maxError, error)
    cases++
    if (actual === 0) opaqueCases++
  }
  try {
    const u = source.uniforms
    u.uGasAbsorption.value = 1
    u.uDustStrength.value = 0
    u.uShadowStrength.value = 1
    for (let cycle = 0; cycle < 2; cycle++) for (const texture of textures.slice(0, 3)) {
      source.setBakedDensityTexture(texture)
      const field = texture === textures[0] ? 1 : 32
      for (const steps of [1, 6, 16]) for (const tau of [0, 0.7, 10.99, 11, 11.99, 12, 12.01, 12.8]) {
        // Float fields reach tau12.8 with density0.4: a bound assuming [0,1]
        // would wrongly choose the uncut loop and return a nonzero result.
        u.uLightSteps.value = steps
        u.uDensityScale.value = tau / field
        check(`texture${textures.indexOf(texture)}/${cycle}/${steps}/${tau}`, tau > 12 ? 0 : Math.exp(-tau), tau === 12)
      }
      source.setBakedDensityTexture(null)
    }
    source.setBakedDensityTexture(textures[0])
    u.uDensityScale.value = 0.2
    u.uGasAbsorption.value = 0.4
    u.uDustStrength.value = 0.5
    const paths = [
      { point: [0, 0, 0], star: [0, 0, 2], length: 1 },
      { point: [0, 0, 0], star: [0, 0, 0.4], length: 0.4 },
      { point: [0, 0, 0], star: [0, 0, 0], length: 0 },
      { point: [1, 0, 0], star: [2, 0, 0], length: 0 },
      { point: [1, 0, 0], star: [-2, 0, 0], length: 2 },
      { point: [1, 0, 0], star: [1, 4, 0], length: 1 },
      { point: [0, 0, 0], star: [-2, 2, -2], length: Math.sqrt(3) }
    ]
    for (const [index, path] of paths.entries()) for (const steps of [1, 6, 16]) for (const shadow of [0, 0.5, 1, 30]) {
      material.uniforms.uPoint.value.fromArray(path.point)
      material.uniforms.uStar.value.fromArray(path.star)
      u.uLightSteps.value = steps
      u.uShadowStrength.value = shadow
      const tau = 0.58 * path.length * shadow
      check(`path${index}/${steps}/${shadow}`, tau >= 12 ? 0 : Math.exp(-tau))
    }
    source.setBakedDensityTexture(textures[3])
    material.uniforms.uPoint.value.set(0, 0, -1)
    material.uniforms.uStar.value.set(0, 0, 2)
    u.uDensityScale.value = 0.5
    u.uGasAbsorption.value = 1
    u.uDustStrength.value = 0.25
    for (const steps of [1, 6, 16]) for (const shadow of [1, 30]) {
      u.uLightSteps.value = steps
      u.uShadowStrength.value = shadow
      // Midpoint1 lands in the upper slab: sigma .45 * path2 = .9.
      // Even counts split the path: lower .25 + upper .45 = .7.
      const tau = (steps === 1 ? 0.9 : 0.7) * shadow
      check(`slabs/${steps}/${shadow}`, tau >= 12 ? 0 : Math.exp(-tau))
    }
    const programs = renderer.info.programs?.length ?? 0
    if (programs !== 1) throw new Error(`Light parameter/texture switches created ${programs} programs`)
    return { cases, opaqueCases, maxError, programs }
  } finally {
    mesh.geometry.dispose()
    material.dispose()
    source.dispose()
    textures.forEach(texture => texture.dispose())
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
