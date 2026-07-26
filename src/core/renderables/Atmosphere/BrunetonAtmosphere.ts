import { BufferGeometry, Mesh, SphereGeometry, Vector3, WebGLRenderer } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'
import { BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { UpdateContext } from '@/core/UpdateContext'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'

class BrunetonAtmosphere extends Mesh implements Acceptable<IObject3DVisitor> {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: BrunetonAtmosphereMaterial

  /**
   * Позиция источника света. Движок пока не доставляет позиции светил
   * в материалы — все шейдеры (Planet/Ring/Atmosphere) живут на общей
   * конвенции «звезда в начале координат», поэтому ноль здесь корректен
   * и согласован с терминатором планеты. При появлении доставки света
   * из scenario.lightSources обновлять поле нужно будет здесь.
   */
  private lightPosition: Vector3 = new Vector3()

  /**
   * Генератор LUT хранится на время жизни атмосферы: текстуры принадлежат
   * его render target'ам, освободить их можно только через его dispose()
   */
  private lutGenerator!: AtmosphereLUTGenerator

  public constructor(
    model: Actor,
    private readonly renderer: WebGLRenderer
  ) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    // Форма `renderingObject.data` утверждается локально, где категория известна
    const config: AtmosphereConfig = requireRenderingData<AtmosphereConfig>(this.model, 'BrunetonAtmosphere')

    const radius: number = toThreeJSUnits(config.topRadius)

    this.lutGenerator = new AtmosphereLUTGenerator(this.renderer)
    const lut = this.lutGenerator.generate(config)

    this.geometry = new SphereGeometry(radius, 256, 256)

    this.material = new BrunetonAtmosphereMaterial(this.model)
    this.material.bindLUTTextures(lut)

    this.name = this.model.getAttribute('name', '') + 'Atmosphere'
  }

  /**
   * Освобождает GPU-ресурсы: LUT render target'ы и материалы генератора,
   * геометрию и материал меша. Вызывать при демонтаже сцены.
   */
  public dispose(): void {
    this.lutGenerator.dispose()
    this.material.dispose()
    this.geometry.dispose()
  }

  public updateObject(ctx: UpdateContext): void {
    this.material.update(this, ctx.camera, this.lightPosition)
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitComponent(this)
  }
}

export { BrunetonAtmosphere }
