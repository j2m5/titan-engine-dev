import { BufferGeometry, Mesh } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { StarMaterial } from '@/core/materials/StarMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'
import { STAR_GRANULATION_TIME_SCALE } from '@/core/materials/shaders/lib/helpers'
import { SphereDetail } from '@/core/renderables/utils/SphereDetail'

class Star extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  private readonly radius: number
  /** Грубая сфера вдали, плотная 256 — пока диск крупно в кадре */
  private sphereDetail!: SphereDetail

  public constructor(model: Actor) {
    super()
    this.model = model
    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)

    this.__setup()
  }

  __setup(): void {
    this.sphereDetail = new SphereDetail(this, this.radius, { denseSegments: 256, circumscribe: false })
    this.material = new StarMaterial(this.model)

    this.name = this.model.getAttribute('name', '') + 'Star'
    this.userData.type = 'star'
    this.userData.clickable = true
  }

  public updateObject(ctx: UpdateContext): void {
    this.sphereDetail.update(ctx.camera)
    // Медленная эволюция грануляции; множитель общий с импостором
    // (FakeStar.updateObject) — скорость «жизни» поверхности одна на оба LOD
    this.material.uniforms.time.value = ctx.elapsed * STAR_GRANULATION_TIME_SCALE
  }
}

export { Star }
