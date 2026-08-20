import { BufferGeometry, Mesh, SphereGeometry, Vector3, WebGLRenderer } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'
import { AtmospherePass, BrunetonAtmosphereMaterial } from '@/core/renderables/Atmosphere/BrunetonAtmosphereMaterial'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { UpdateContext } from '@/core/UpdateContext'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { adjustAtmosphereForTerrainFloor } from '@/core/renderables/Atmosphere/terrainFloorAdjust'

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

  /**
   * Проход сложения (in-scatter). Композиция атмосферы раскладывается на два
   * прохода блендинга: сам объект множит кадр на пропускание, этот меш
   * добавляет свечение. Геометрия общая с родителем — освобождает её родитель.
   */
  public scatterPass!: Mesh<BufferGeometry, BrunetonAtmosphereMaterial>

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

    // Терраформный родитель: дно опускается до пола рельефа, иначе аналитический
    // горизонт шейдера повисает над реальным силуэтом (атмосфера «отлипает»).
    // LUT и юниформы обязаны считаться из ОДНОГО подогнанного конфига.
    //
    // Пол берётся из САМОГО конфига (ручка данных), а не из реестра карт
    // высот: карта с гейтом приезжает только на подлёте, здесь её нет
    // НИКОГДА, и прежнее чтение реестра давало ноль всегда — подгонка была
    // мертва у всех 8 тел с атмосферой. См. докблок terrainFloorMeters.
    const adjusted: AtmosphereConfig = adjustAtmosphereForTerrainFloor(config, config.terrainFloorMeters ?? 0)

    const radius: number = toThreeJSUnits(adjusted.topRadius)

    this.lutGenerator = new AtmosphereLUTGenerator(this.renderer)
    const lut = this.lutGenerator.generate(adjusted)

    this.geometry = new SphereGeometry(radius, 256, 256)

    this.material = new BrunetonAtmosphereMaterial(this.model, AtmospherePass.Transmittance)
    this.material.setAtmosphereConfig(adjusted)
    this.material.bindLUTTextures(lut)

    this.name = this.model.getAttribute('name', '') + 'Atmosphere'

    // Порядок несущий: умножение на пропускание должно лечь ДО сложения,
    // иначе in-scatter окажется домножен на пропускание.
    this.renderOrder = 0

    const scatterMaterial: BrunetonAtmosphereMaterial = new BrunetonAtmosphereMaterial(
      this.model,
      AtmospherePass.InScatter
    )
    scatterMaterial.shareUniformsWith(this.material)

    this.scatterPass = new Mesh(this.geometry, scatterMaterial)
    this.scatterPass.renderOrder = 1
    this.scatterPass.name = this.name + 'InScatter'

    this.add(this.scatterPass)
  }

  /**
   * Освобождает GPU-ресурсы: LUT render target'ы и материалы генератора,
   * геометрию и материал меша. Вызывать при демонтаже сцены.
   */
  public dispose(): void {
    this.lutGenerator.dispose()
    this.material.dispose()
    this.scatterPass.material.dispose()
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
