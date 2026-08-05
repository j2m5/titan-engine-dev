import { LOD, WebGLRenderer } from 'three'
import { starLodSwitchDistance } from '@/core/helpers/apparentSize'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * LOD звезды: диск вблизи, билборд-импостор вдали. Дистанцию переключения
 * держит у себя, потому что она НЕ константа — билборд (FakeStar) меряет свой
 * размер живой высотой вьюпорта, и замороженное при создании число расходится
 * с ним после первого же ресайза окна.
 * radiusKm — физический радиус звезды в километрах.
 */
class StarLod extends LOD {
  public constructor(
    private readonly radiusKm: number,
    private readonly renderer: WebGLRenderer
  ) {
    super()
  }

  /**
   * Расстояние, на котором диск звезды занимает столько же пикселей, сколько
   * рисует билборд. Высота вьюпорта берётся ЖИВАЯ — та же, по которой считает
   * себя FakeStar.updateObject.
   */
  public switchDistance(fovDegrees: number): number {
    return starLodSwitchDistance(this.radiusKm, fovDegrees, this.renderer.domElement.height)
  }

  public updateObject(ctx: UpdateContext): void {
    // Уровень 1 — билборд: addLevel сортирует по дистанции, диск стоит на нуле
    if (this.levels.length < 2) return

    this.levels[1].distance = this.switchDistance(ctx.camera.fov)
  }
}

export { StarLod }
