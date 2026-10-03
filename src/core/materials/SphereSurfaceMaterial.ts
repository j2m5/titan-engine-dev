import { Actor } from '@/core/models/Actor'
import { SphereSurfaceShader } from '@/core/materials/shaders/SphereSurfaceShader'
import { PlanetSurfaceMaterial, type SurfaceMaps } from '@/core/materials/PlanetSurfaceMaterial'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'

/**
 * Материал поверхности на SphereGeometry (Planet): гиганты и каменные тела,
 * пока их карта высот не загружена. Карту высот не спрашивает вовсе —
 * рельефных дефайнов и атрибутов патча у сферы нет, в том числе в окне
 * даунгрейда (см. докблок RenderableFactory.swapSurface).
 */
class SphereSurfaceMaterial extends PlanetSurfaceMaterial {
  public constructor(model: Actor, atmosphereRegistry?: AtmosphereRegistry) {
    super(model, atmosphereRegistry, new SphereSurfaceShader(model))
  }

  protected updatePath({ planetData, specularMap }: SurfaceMaps): Record<string, string> {
    // slope-карту сфера не сэмплит: сэмплер общего пролога пуст
    this.uniforms.bumpMap.value = undefined

    return {
      // Specular-карта — маска «океан/суша»: на сфере блик рисует сама
      // поверхность (водная оболочка есть только у рельефа) — тем же законом,
      // что вода (waterGlintFunctions)
      ...(specularMap && { USE_SPECULAR: '1' }),
      // Процедурная деталь облаков гиганта: домен — body-локальный vPosition сферы
      ...(planetData.giantDetail === true && { USE_GIANT_DETAIL: '1' })
    }
  }

  protected resetPath(): void {}
}

export { SphereSurfaceMaterial }
