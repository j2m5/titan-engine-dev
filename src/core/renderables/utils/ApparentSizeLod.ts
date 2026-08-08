import { LOD, WebGLRenderer } from 'three'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * LOD по видимому размеру: диск вблизи, билборд-импостор вдали. Дистанцию
 * переключения держит у себя, потому что она НЕ константа — билборд меряет
 * свой размер живой высотой вьюпорта, и замороженное при создании число
 * расходится с ним после первого же ресайза окна.
 *
 * radiusKm — физический радиус тела в километрах.
 * impostorPixels — видимый размер билборда: у диска и билборда он обязан
 * совпасть, иначе на переключении будет скачок размера.
 */
class ApparentSizeLod extends LOD {
  public constructor(
    private readonly radiusKm: number,
    private readonly renderer: WebGLRenderer,
    private readonly impostorPixels: number
  ) {
    super()
  }

  public switchDistance(fovDegrees: number): number {
    return distanceForApparentSize(
      toThreeJSUnits(2 * this.radiusKm),
      this.impostorPixels,
      fovDegrees,
      this.renderer.domElement.height
    )
  }

  public updateObject(ctx: UpdateContext): void {
    // Уровень 1 — билборд: addLevel сортирует по дистанции, диск стоит на нуле
    if (this.levels.length < 2) return

    this.levels[1].distance = this.switchDistance(ctx.camera.fov)
  }
}

export { ApparentSizeLod }
