import { LOD, WebGLRenderer } from 'three'
import { config } from '@/core/framework/config'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * LOD чёрной дыры: полный реймарчер (L0) вблизи, импостор вдали. Дистанцию
 * переключения держит у себя и пересчитывает каждый кадр, потому что она
 * НЕ константа: порог задан в экранных пикселях, а высота вьюпорта и fov
 * живут своей жизнью (ресайз окна, смена камеры). Тот же паттерн, что
 * StarLod — прежняя замороженная дистанция расходилась с порогом после
 * первого же ресайза.
 * simulationRadiusKm — радиус зоны симуляции лензирования в километрах.
 */
class BlackHoleLod extends LOD {
  public constructor(
    private readonly simulationRadiusKm: number,
    private readonly renderer: WebGLRenderer
  ) {
    super()
  }

  /**
   * Расстояние, на котором диаметр зоны симуляции занимает
   * config('blackHole.lodPixels') экранных пикселей. Высота вьюпорта — ЖИВАЯ.
   */
  public switchDistance(fovDegrees: number): number {
    return distanceForApparentSize(
      toThreeJSUnits(2 * this.simulationRadiusKm),
      config('blackHole.lodPixels'),
      fovDegrees,
      this.renderer.domElement.height
    )
  }

  public updateObject(ctx: UpdateContext): void {
    // Уровень 1 — импостор: addLevel сортирует по дистанции, L0 стоит на нуле
    if (this.levels.length < 2) return

    this.levels[1].distance = this.switchDistance(ctx.camera.fov)
  }
}

export { BlackHoleLod }
