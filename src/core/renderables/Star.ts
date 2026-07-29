import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { StarMaterial } from '@/core/materials/StarMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'

class Star extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  private readonly radius: number

  public constructor(model: Actor) {
    super()
    this.model = model
    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)

    this.__setup()
  }

  __setup(): void {
    this.geometry = new SphereGeometry(this.radius, 256, 256)
    this.material = new StarMaterial(this.model)

    this.name = this.model.getAttribute('name', '') + 'Star'
    this.userData.type = 'star'
    this.userData.clickable = true
  }

  public updateObject(ctx: UpdateContext): void {
    // Медленная эволюция грануляции; юниформ раньше не обновлялся вовсе —
    // поверхность была заморожена (см. спеку этапа 2)
    this.material.uniforms.time.value = ctx.elapsed * 0.01
  }
}

export { Star }
