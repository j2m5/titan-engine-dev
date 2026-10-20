import type { Vector3 } from 'three'
import type { SunTintTarget } from '@/core/materials/SunTintBinding'
import type { AtmosphereEntry, AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'

/** Borrows the atmosphere's scattering texture. The atmosphere owns its lifetime. */
export class WaterSkyBinding {
  private entry: AtmosphereEntry | undefined

  public constructor(
    private readonly material: SunTintTarget,
    private readonly registry: AtmosphereRegistry | undefined,
    private readonly atmosphereActorId: number | undefined,
    private readonly datumRadiusKm: number
  ) {}

  public get active(): boolean {
    return this.entry !== undefined
  }

  public sync(): void {
    const entry = this.datumRadiusKm > 0 && this.atmosphereActorId !== undefined
      ? this.registry?.get(this.atmosphereActorId) : undefined
    const uniforms = this.material.uniforms
    if (entry !== this.entry) {
      const wasActive = this.active
      this.entry = entry
      uniforms.uWaterSkyScattering.value = entry?.lut.scattering ?? null
      if (entry) {
        ;(uniforms.uWaterSkyRayleigh.value as Vector3).fromArray(entry.config.rayleighScattering)
        ;(uniforms.uWaterSkyMie.value as Vector3).fromArray(entry.config.mieScattering)
        uniforms.uWaterSkyMieG.value = entry.config.miePhaseFunctionG
        uniforms.uWaterSkyMuSMin.value = entry.config.muSMin
      }
      if (wasActive !== this.active) {
        const defines = { ...this.material.defines }
        if (entry) defines.USE_WATER_SKY = '1'
        else delete defines.USE_WATER_SKY
        this.material.defines = defines
        this.material.needsUpdate = true
      }
    }
    // These display controls can change without rebuilding the LUT/entry.
    if (entry) {
      uniforms.uWaterSkyExposure.value = entry.config.exposure ?? 10
      uniforms.uWaterSkyHdrKnee.value = Math.max(0, entry.config.hdrKnee ?? 1)
    }
  }

  public reset(): void {
    this.entry = undefined
    this.material.uniforms.uWaterSkyScattering.value = null
  }
}
