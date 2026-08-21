import { BufferGeometry, Mesh, RingGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { RingMaterial } from '@/core/materials/RingMaterial'
import { RingDepthMaterial, RING_DEPTH_ALPHA_TEST_DEFAULT } from '@/core/materials/RingDepthMaterial'
import { degToRad } from 'three/src/math/MathUtils'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { requireRenderingData } from '@/core/helpers/renderingData'
import { IRingRenderingObject } from '@/core/models/types'

/**
 * Порядок внутри прозрачной очереди: кольцо до пыли (DUST_RENDER_ORDER) —
 * пыль его гало. К атмосфере порядок отношения не имеет: она — полноэкранный
 * эффект по глубине, и что затуманивать, решает depth-буфер.
 */
export const RING_RENDER_ORDER = 2

class Ring extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: AbstractShaderMaterial

  public constructor(model: Actor) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    // Кольцо знает свою категорию, поэтому форма `renderingObject.data` утверждается локально
    const ringData: IRingRenderingObject = requireRenderingData<IRingRenderingObject>(this.model, 'Ring')

    const innerRadius: number = toThreeJSUnits(ringData.innerRadius)
    const outerRadius: number = toThreeJSUnits(ringData.outerRadius)

    const material: RingMaterial = new RingMaterial(this.model)

    this.geometry = new RingGeometry(innerRadius, outerRadius, 256)
    this.material = material

    this.name = this.model.getAttribute('name', '') + 'Ring'
    this.renderOrder = RING_RENDER_ORDER
    this.rotateX(degToRad(90))

    this.add(this.__makeDepthPrepass(material, ringData))
  }

  /**
   * Глубинный пре-пасс: плотные тексели кольца пишут глубину, которую цветовой
   * проход (`depthWrite = false`) не пишет. Без него полноэкранная атмосфера
   * видит на месте кольца глубину диска планеты и тонирует кольцо перед диском
   * дымкой этого диска — см. докблок `RingDepthMaterial`.
   *
   * Геометрия общая с кольцом по ссылке: у пре-пасса тот же силуэт, дублировать
   * 256 сегментов незачем. Разбор поддерева (`disposeSceneTree`) освободит её
   * дважды — повторный `dispose()` у `BufferGeometry` холостой, слушатель
   * снимается первым же вызовом; ту же терпимость к разделяемым ресурсам
   * фиксирует `disposeSceneTree.spec`. Материал у пре-пасса свой и
   * освобождается тем же обходом.
   */
  private __makeDepthPrepass(material: RingMaterial, ringData: IRingRenderingObject): Mesh {
    const depthAlphaTest: number = ringData.depthAlphaTest ?? RING_DEPTH_ALPHA_TEST_DEFAULT
    const prepass: Mesh = new Mesh(this.geometry, new RingDepthMaterial(material, depthAlphaTest))

    prepass.name = this.name + 'DepthPrepass'
    prepass.frustumCulled = this.frustumCulled
    // Пре-пасс невидим и не должен перехватывать выбор актора у самого кольца
    prepass.userData.clickable = false

    return prepass
  }
}

export { Ring }
