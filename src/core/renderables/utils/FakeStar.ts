import {
  AdditiveBlending,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Texture,
  Vector3,
  WebGLRenderer
} from 'three'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { STAR_IMPOSTOR_PIXELS, frameHeightAt } from '@/core/helpers/apparentSize'
import { colorTemperatureToRGB, rgbToHex } from '@/core/materials/shaders/lib/helpers'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * Объект созданный в качестве LOD-Level-2 для звездного меша
 * представляет собой псевдо-спрайт лишенный недостатков оригинального спрайта Three.js,
 * но наполненный собственными магическими числами и вычислениями, подстроенными под текущий рендер-пайплайн
 * так что по итогу назначение этого объекта только одно, см выше
 * не использовать для чего-то другого кроме как LOD-утилиту для сверх-ярких источников света
 */

class FakeStar extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: MeshStandardMaterial

  private readonly worldPosition: Vector3 = new Vector3()
  private readonly cameraPosition: Vector3 = new Vector3()

  public constructor(
    model: Actor,
    private readonly renderer: WebGLRenderer
  ) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    const map: Texture = resourceStorage.getTexture('round.png')!
    const temperature = this.model.physicalObject?.getAttribute('temperature', 5700) ?? 5700
    const correctedTemperature = temperature + 1300
    const rgb = colorTemperatureToRGB(correctedTemperature)
    const color = rgbToHex(rgb)

    this.geometry = new PlaneGeometry(1, 1)
    this.material = new MeshStandardMaterial({
      map,
      blending: AdditiveBlending,
      emissive: color,
      emissiveIntensity: 40
    })
  }

  public updateObject(ctx: UpdateContext): void {
    const cameraPosition: Vector3 = ctx.camera.getWorldPosition(this.cameraPosition)

    this.lookAt(cameraPosition)

    // Позиция мировая, а не локальная: билборд висит в нуле родительского узла,
    // и по локальной мерилось бы расстояние до начала сцены. Ту же величину
    // меряет LOD.update, выбирая между диском и билбордом
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(cameraPosition)
    const viewportHeight: number = this.renderer.domElement.height
    // Мировой размер, дающий STAR_IMPOSTOR_PIXELS пикселей на этом расстоянии:
    // доля кадра по высоте, пропорциональная доле пикселей по высоте
    const worldSize: number = (STAR_IMPOSTOR_PIXELS / viewportHeight) * frameHeightAt(distance, ctx.camera.fov)

    this.scale.setScalar(worldSize)
  }
}

export { FakeStar }
