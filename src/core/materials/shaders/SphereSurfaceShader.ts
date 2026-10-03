import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { Uniform } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { resolveWaterSurfaceParams } from '@/core/terrain/waterSurfaceParams'
import { farGlintAlpha2 } from '@/core/materials/shaders/lib/chunks/waterOctavesMath'
import { PlanetSurfaceShader, PlanetSurfaceUniforms } from '@/core/materials/shaders/PlanetSurfaceShader'

// Деталь облаков гиганта (чанк GiantDetail) — дефолты ручек тела; сама фича
// под дефайном USE_GIANT_DETAIL, юниформы форвардятся всегда.
// Клетка ≈ мелкая турбулентность полос Юпитера (R 69 911 км), вытяжка — вдоль
// полосы; конец fade — в радиусах тела.
const DEFAULT_GIANT_DETAIL_STRENGTH = 0.35
const DEFAULT_GIANT_DETAIL_SCALE_KM = 300
const DEFAULT_GIANT_DETAIL_STRETCH = 6
const DEFAULT_GIANT_DETAIL_WARP = 0.6
const DEFAULT_GIANT_DETAIL_TEXTURE_WARP = 2
const DEFAULT_GIANT_DETAIL_FADE_RADII = 1.5

export interface SphereSurfaceUniforms extends PlanetSurfaceUniforms {
  uWaterFarAlpha2: number
  uWaterGlintGain: number
  uGiantRadiusKm: number
  uGiantDetailStrength: number
  uGiantDetailScaleKm: number
  uGiantDetailStretch: number
  uGiantDetailWarp: number
  uGiantDetailTextureWarp: number
  uGiantDetailFadeUnits: number
}

export type SphereSurfaceUniformKey = keyof SphereSurfaceUniforms

/** Юниформы поверхности на SphereGeometry: общие плюс деталь гиганта и блик воды на сфере. */
class SphereSurfaceShader extends PlanetSurfaceShader<SphereSurfaceUniformKey> {
  public constructor(model: Actor) {
    super(model, SphereSurfaceShaderTemplate, 'SphereSurfaceShader')
    const planetData = this.planetData
    const radiusKm = this.radiusKm

    // Блик сферы тела с водой — те же ручки и тот же расчёт, что у WaterShader
    const waterSurface = resolveWaterSurfaceParams(planetData, this.model.getAttribute?.('name', '?') ?? '?')

    this.uniforms = {
      ...this.surfaceUniforms,
      uWaterFarAlpha2: new Uniform(farGlintAlpha2(waterSurface.waterRoughness, waterSurface.waterRippleStrength)),
      uWaterGlintGain: new Uniform(waterSurface.waterGlintGain),
      // Домен шума гиганта задан в км поверхности: клетка не зависит от размера тела
      uGiantRadiusKm: new Uniform(radiusKm),
      uGiantDetailStrength: new Uniform(planetData.giantDetailStrength ?? DEFAULT_GIANT_DETAIL_STRENGTH),
      // Кламп положительным минимумом: 0 в знаменателе домена (giantDomain) дал бы NaN
      uGiantDetailScaleKm: new Uniform(Math.max(planetData.giantDetailScaleKm ?? DEFAULT_GIANT_DETAIL_SCALE_KM, 1e-3)),
      uGiantDetailStretch: new Uniform(Math.max(planetData.giantDetailStretch ?? DEFAULT_GIANT_DETAIL_STRETCH, 1e-3)),
      uGiantDetailWarp: new Uniform(planetData.giantDetailWarp ?? DEFAULT_GIANT_DETAIL_WARP),
      uGiantDetailTextureWarp: new Uniform(planetData.giantDetailTextureWarp ?? DEFAULT_GIANT_DETAIL_TEXTURE_WARP),
      // Кламп положительным минимумом: нулевой fade — деление на ноль в smoothstep
      // чанка (тело без physicalObject или с giantDetailFadeKm: 0)
      uGiantDetailFadeUnits: new Uniform(
        Math.max(toThreeJSUnits(planetData.giantDetailFadeKm ?? DEFAULT_GIANT_DETAIL_FADE_RADII * radiusKm), 1e-6)
      )
    }
  }
}

export { SphereSurfaceShader }
