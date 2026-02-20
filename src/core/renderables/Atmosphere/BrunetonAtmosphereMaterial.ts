/**
 * BrunetonAtmosphereMaterial.ts
 *
 * Material wrapper for the parametric Bruneton atmospheric scattering shader.
 * Accepts any AtmosphereConfig — not limited to Earth.
 *
 * === USAGE ===
 *
 *   import { EARTH_ATMOSPHERE } from './AtmosphereConfig'
 *   import { AtmosphereLUTGenerator } from './AtmosphereLUTGenerator'
 *
 *   // Generate LUTs for the planet
 *   const lutGenerator = new AtmosphereLUTGenerator(renderer)
 *   const luts = lutGenerator.generate(EARTH_ATMOSPHERE)
 *
 *   // Create material
 *   const material = new BrunetonAtmosphereMaterial()
 *   material.setAtmosphereConfig(EARTH_ATMOSPHERE)
 *   material.bindLUTTextures(luts)
 *
 *   // Create mesh (topRadius from config, converted to Three.js units)
 *   const geometry = new SphereGeometry(toThreeJSUnits(EARTH_ATMOSPHERE.topRadius), 64, 64)
 *   const atmosphereMesh = new Mesh(geometry, material)
 *   planet.add(atmosphereMesh)
 *
 *   // Each frame:
 *   material.update(atmosphereMesh, camera, starWorldPosition)
 */

import {
  RawShaderMaterial,
  DoubleSide,
  NormalBlending,
  GLSL3,
  Mesh,
  PerspectiveCamera,
  Vector3,
  Vector2,
  Matrix4,
  Uniform
} from 'three'
import { BrunetonAtmosphereShaderTemplate } from './BrunetonAtmosphereShaderTemplate'
import { AtmosphereConfig, createAtmosphereUniforms, updateAtmosphereUniforms } from './AtmosphereConfig'
import { AtmosphereLUTs } from './AtmosphereLUTGenerator'
import { IUniform } from 'three/src/renderers/shaders/UniformsLib'
import { Actor } from '@/core/models/Actor'

/**
 * Deep-clone a uniforms object so each material instance owns independent
 * Uniform objects. Without this, spread ({...uniforms}) creates a shallow
 * copy where all instances share the same Uniform references — writing to
 * one material's uniform silently overwrites every other material's value.
 */
function cloneUniforms(src: { [uniform: string]: IUniform }): { [uniform: string]: IUniform } {
  const dst: { [uniform: string]: IUniform } = {}
  for (const key in src) {
    const v = src[key].value
    if (v === null || v === undefined) {
      dst[key] = new Uniform(v)
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      dst[key] = new Uniform(v)
    } else if (v.isVector2) {
      dst[key] = new Uniform(v.clone())
    } else if (v.isVector3) {
      dst[key] = new Uniform(v.clone())
    } else if (v.isMatrix4) {
      dst[key] = new Uniform(v.clone())
    } else if (v instanceof Float32Array) {
      dst[key] = new Uniform(new Float32Array(v))
    } else {
      dst[key] = new Uniform(v)
    }
  }
  return dst
}

export class BrunetonAtmosphereMaterial extends RawShaderMaterial {
  private _modelViewMatrix = new Matrix4()
  private _rotationOnlyView = new Matrix4()
  private _invModelMatrix = new Matrix4()
  private _localCameraPos = new Vector3()
  private _localSunDir = new Vector3()

  constructor(model: Actor) {
    super({
      glslVersion: GLSL3,
      uniforms: cloneUniforms({
        ...BrunetonAtmosphereShaderTemplate.uniforms,
        ...createAtmosphereUniforms(model.renderingObject?.getAttribute('data'))
      }),
      vertexShader: BrunetonAtmosphereShaderTemplate.vertexShader,
      fragmentShader: BrunetonAtmosphereShaderTemplate.fragmentShader,

      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending
    })
  }

  /**
   * Configure atmosphere parameters for a specific planet.
   * This updates all atmosphere-related uniforms in the shader.
   *
   * IMPORTANT: The LUT textures must have been precomputed with
   * the SAME config via AtmosphereLUTGenerator.generate(config).
   * Parameters and LUTs must match — mismatches produce artifacts.
   */
  setAtmosphereConfig(config: AtmosphereConfig): void {
    updateAtmosphereUniforms(this.uniforms, config)

    // Update sun_size based on config's angular radius
    this.uniforms.sun_size.value = new Vector2(Math.tan(config.sunAngularRadius), Math.cos(config.sunAngularRadius))
  }

  /**
   * Bind precomputed LUT textures.
   * Accepts either the result of AtmosphereLUTGenerator.generate()
   * or a Map from the legacy DTLoader.
   */
  bindLUTTextures(luts: AtmosphereLUTs): void {
    this.uniforms.transmittance_texture.value = luts.transmittance
    this.uniforms.scattering_texture.value = luts.scattering
    this.uniforms.irradiance_texture.value = luts.irradiance
    this.uniforms.single_mie_scattering_texture.value = luts.scattering
  }

  /**
   * Update per-frame uniforms.
   */
  update(mesh: Mesh, camera: PerspectiveCamera, lightPosition: Vector3): void {
    const mw = mesh.matrixWorld.elements
    const cw = camera.matrixWorld.elements

    // ── 1. Camera-relative model matrix (для gl_Position) ──
    const crModelMatrix = this.uniforms.modelMatrix.value as Matrix4
    crModelMatrix.copy(mesh.matrixWorld)
    crModelMatrix.elements[12] = mw[12] - cw[12]
    crModelMatrix.elements[13] = mw[13] - cw[13]
    crModelMatrix.elements[14] = mw[14] - cw[14]

    // ── 2. Camera-relative modelViewMatrix ──
    const rotView = this._rotationOnlyView
    rotView.copy(camera.matrixWorldInverse)
    rotView.elements[12] = 0
    rotView.elements[13] = 0
    rotView.elements[14] = 0

    this._modelViewMatrix.multiplyMatrices(rotView, crModelMatrix)
    this.uniforms.modelViewMatrix.value.copy(this._modelViewMatrix)

    // ── 3. Projection (без изменений) ──
    this.uniforms.projectionMatrix.value.copy(camera.projectionMatrix)

    // ── 4. Local camera position (float64 на CPU!) ──
    // = inverse(originalModelMatrix) * cameraWorldPosition
    // Используем ОРИГИНАЛЬНУЮ matrixWorld (не camera-relative)
    this._invModelMatrix.copy(mesh.matrixWorld).invert()

    this._localCameraPos.set(cw[12], cw[13], cw[14]) // camera world pos
    this._localCameraPos.applyMatrix4(this._invModelMatrix)
    this.uniforms.localCameraPos.value.copy(this._localCameraPos)

    // ── 5. Local sun direction (float64 на CPU!) ──
    // worldSunDir = normalize(lightPosition - meshWorldCenter)
    this._localSunDir.set(lightPosition.x - mw[12], lightPosition.y - mw[13], lightPosition.z - mw[14]).normalize()
    // Transform direction to local space (w=0 equivalent)
    this._localSunDir.transformDirection(this._invModelMatrix)
    this.uniforms.localSunDir.value.copy(this._localSunDir)

    // ── 6. Log depth ──
    const far = camera.far ?? 1e10
    this.uniforms.logDepthBufFC.value = 2.0 / (Math.log(far + 1.0) / Math.LN2)
  }

  // ─── Convenience accessors ───────────────────────────────────

  set exposure(value: number) {
    this.uniforms.exposure.value = value
  }

  get exposure(): number {
    return this.uniforms.exposure.value
  }

  setWhitePoint(r: number, g: number, b: number): void {
    this.uniforms.white_point.value.set(r, g, b)
  }

  set inverseSpaceScale(value: number) {
    this.uniforms.inverseSpaceScale.value = value
  }

  get inverseSpaceScale(): number {
    return this.uniforms.inverseSpaceScale.value
  }
}
