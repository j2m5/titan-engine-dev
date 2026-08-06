import { BufferGeometry, Mesh, SphereGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { StarMaterial } from '@/core/materials/StarMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'
import { STAR_GRANULATION_TIME_SCALE } from '@/core/materials/shaders/lib/helpers'

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
    // Медленная эволюция грануляции; множитель общий с импостором
    // (FakeStar.updateObject) — скорость «жизни» поверхности одна на оба LOD
    this.material.uniforms.time.value = ctx.elapsed * STAR_GRANULATION_TIME_SCALE
  }
}

export { Star }
