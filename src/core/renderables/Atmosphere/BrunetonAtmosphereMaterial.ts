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

import { RawShaderMaterial, DoubleSide, NormalBlending, GLSL3, Mesh, Camera, Vector3, Vector2, Matrix4 } from 'three'
import { BrunetonAtmosphereShaderTemplate } from './BrunetonAtmosphereShaderTemplate'
import { AtmosphereConfig, updateAtmosphereUniforms } from './AtmosphereConfig'
import { AtmosphereLUTs } from './AtmosphereLUTGenerator'

export class BrunetonAtmosphereMaterial extends RawShaderMaterial {
  private _modelViewMatrix = new Matrix4()

  constructor() {
    super({
      glslVersion: GLSL3,
      uniforms: { ...BrunetonAtmosphereShaderTemplate.uniforms },
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
  update(mesh: Mesh, camera: Camera, lightPosition: Vector3): void {
    this.uniforms.modelMatrix.value.copy(mesh.matrixWorld)

    this._modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
    this.uniforms.modelViewMatrix.value.copy(this._modelViewMatrix)

    this.uniforms.projectionMatrix.value.copy(camera.projectionMatrix)
    this.uniforms.cameraPosition.value.copy(camera.position)

    this.uniforms.lightPosition.value.copy(lightPosition)

    // @ts-ignore
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
