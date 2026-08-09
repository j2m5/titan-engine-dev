import { AdditiveBlending, Sprite, SpriteMaterial, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { Colorable } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { colorTemperatureToRGB, rgbToHex } from '@/core/materials/shaders/lib/helpers'

class StarInnerLayer extends Sprite {
  public model: Actor
  declare public material: SpriteMaterial

  private readonly scaleFactor: number

  /**
   * @param opacity прозрачность спрайта. Дефолт звёздный; коричневый карлик
   *   переиспользует этот же слой с меньшим значением — он тлеет, а не сияет
   */
  public constructor(
    model: Actor,
    scaleFactor: number = 0.8,
    private readonly opacity: number = 0.03
  ) {
    super()
    this.model = model
    this.scaleFactor = scaleFactor

    this.__setup()
  }

  __setup(): void {
    const map: Texture = resourceStorage.getTexture('sun.png')!
    const temperature: number = this.model.physicalObject?.getAttribute('temperature', 5700) ?? 5700
    const rgb: Colorable = colorTemperatureToRGB(temperature)
    const color: string = rgbToHex(rgb)

    this.material = new SpriteMaterial({
      map,
      color,
      depthWrite: false,
      sizeAttenuation: false,
      opacity: this.opacity,
      blending: AdditiveBlending
    })

    this.scale.multiplyScalar(this.scaleFactor)

    // Ореол — экранный артефакт «свечения в объективе»: оптически он ложится
    // ПОВЕРХ содержимого сцены в своей точке, поэтому пин здесь принципиален,
    // а не косметичен. При равном z с билбордом (оба в нуле звезды)
    // transparent-сортировка three тайбрейкает по id, то есть по случайному
    // порядку конструирования — renderOrder делает контракт явным.
    // Пин на билборде (renderOrder = -1) был бы ошибкой: renderOrder в
    // сортировке главнее глубины, и билборд рисовался бы РАНЬШЕ туманности
    // позади звезды, которая должна ложиться под него.
    this.renderOrder = 1
  }
}

export { StarInnerLayer }
