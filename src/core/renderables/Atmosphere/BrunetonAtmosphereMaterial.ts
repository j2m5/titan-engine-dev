/**
 * BrunetonAtmosphereMaterial.ts
 *
 * Material wrapper for the adapted Bruneton Precomputed Atmospheric Scattering shader.
 * Uses RawShaderMaterial with GLSL3 (WebGL2 / GLSL 300 es).
 *
 * === USAGE ===
 *
 *   const material = new BrunetonAtmosphereMaterial()
 *   material.bindLUTTextures(dtLoader.textures)
 *
 *   // Configure for specific planet (radii in real km from model data)
 *   material.setPlanetRadii(6371, 6471)  // Earth: surface 6371 km, atmo top 6471 km
 *   material.setPlanetRadii(3390, 3450)  // Mars: surface 3390 km, atmo top 3450 km
 *
 *   // Create atmosphere mesh (topRadiusKm converted to Three.js units)
 *   const geometry = new SphereGeometry(toThreeJSUnits(6471), 64, 64)
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
  Camera,
  Vector3,
  Matrix4,
  DataTexture,
  Data3DTexture
} from 'three'
import { BrunetonAtmosphereShaderTemplate } from './BrunetonAtmosphereShaderTemplate'

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
   * Bind precomputed LUT textures from DTLoader.
   * Call once after textures are loaded.
   */
  bindLUTTextures(textures: Map<string, DataTexture | Data3DTexture>): void {
    const transmittance = textures.get('transmittance')
    const scattering = textures.get('scattering')
    const irradiance = textures.get('irradiance')

    if (!transmittance || !scattering || !irradiance) {
      console.error(
        'BrunetonAtmosphereMaterial: Missing LUT textures.',
        'Expected keys: transmittance, scattering, irradiance.',
        'Available:',
        [...textures.keys()]
      )
      return
    }

    this.uniforms.transmittance_texture.value = transmittance
    this.uniforms.scattering_texture.value = scattering
    this.uniforms.irradiance_texture.value = irradiance
    this.uniforms.single_mie_scattering_texture.value = scattering
  }

  /**
   * Configure atmosphere dimensions for a specific planet.
   *
   * The shader scales all positions so that the planet surface maps to
   * Bruneton's reference bottom_radius (6360 km). This keeps the
   * precomputed Earth LUTs valid for any planet size.
   *
   * @param bottomRadiusKm - Planet surface radius in real kilometers
   * @param topRadiusKm - Atmosphere outer boundary in real kilometers
   *
   * @example
   *   // Earth
   *   material.setPlanetRadii(6371, 6471)
   *   // Mars
   *   material.setPlanetRadii(3390, 3450)
   *   // Jupiter (gas giant — thick atmosphere)
   *   material.setPlanetRadii(69911, 70300)
   */
  setPlanetRadii(bottomRadiusKm: number, topRadiusKm: number): void {
    this.uniforms.bottomRadiusKm.value = bottomRadiusKm
    this.uniforms.topRadiusKm.value = topRadiusKm
  }

  /**
   * Update per-frame uniforms.
   * Call each frame before rendering.
   */
  update(mesh: Mesh, camera: Camera, lightPosition: Vector3): void {
    this.uniforms.modelMatrix.value.copy(mesh.matrixWorld)

    this._modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
    this.uniforms.modelViewMatrix.value.copy(this._modelViewMatrix)

    this.uniforms.projectionMatrix.value.copy(camera.projectionMatrix)
    this.uniforms.cameraPosition.value.copy(camera.position)

    this.uniforms.lightPosition.value.copy(lightPosition)

    // @ts-ignore - camera.far exists on PerspectiveCamera
    const far = camera.far ?? 1e10
    this.uniforms.logDepthBufFC.value = 2.0 / (Math.log(far + 1.0) / Math.LN2)
  }

  // ─── Convenience accessors ───────────────────────────────────────

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
