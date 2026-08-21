import { Object3D, WebGLRenderer } from 'three'
import { Acceptable } from '@/core/services/visitors/Acceptable'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { Actor } from '@/core/models/Actor'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { AtmosphereLUTGenerator } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { adjustAtmosphereForTerrainFloor } from '@/core/renderables/Atmosphere/terrainFloorAdjust'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'

/**
 * Узел атмосферы: геометрии нет — оболочку рисует полноэкранный проход по
 * глубине сцены. Узел владеет LUT (освободить их можно только через dispose()
 * генератора) и регистрирует себя в реестре; `matrixWorld` узла — центр
 * оболочки, эффект читает его сам, поэтому updateObject не нужен.
 */
class BrunetonAtmosphere extends Object3D implements Acceptable<IObject3DVisitor> {
  public model: Actor

  private lutGenerator!: AtmosphereLUTGenerator

  public constructor(
    model: Actor,
    private readonly renderer: WebGLRenderer,
    private readonly registry: AtmosphereRegistry
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
    // LUT и запись реестра обязаны считаться из ОДНОГО подогнанного конфига.
    //
    // Пол берётся из САМОГО конфига (ручка данных), а не из реестра карт
    // высот: карта с гейтом приезжает только на подлёте, здесь её нет
    // НИКОГДА. См. докблок terrainFloorMeters.
    const adjusted: AtmosphereConfig = adjustAtmosphereForTerrainFloor(config, config.terrainFloorMeters ?? 0)

    this.lutGenerator = new AtmosphereLUTGenerator(this.renderer)
    const lut = this.lutGenerator.generate(adjusted)

    this.name = this.model.getAttribute('name', '') + 'Atmosphere'

    this.registry.register({
      actorId: this.model.getAttribute('id', -1) as number,
      name: this.name,
      object: this,
      config: adjusted,
      lut
    })
  }

  /**
   * Снимает запись из реестра и освобождает GPU-ресурсы: LUT живут в render
   * target'ах генератора. Вызывать при демонтаже сцены.
   */
  public dispose(): void {
    this.registry.unregister(this.model.getAttribute('id', -1) as number)
    this.lutGenerator.dispose()
  }

  public accept(visitor: IObject3DVisitor): void {
    visitor.visitComponent(this)
  }
}

export { BrunetonAtmosphere }
