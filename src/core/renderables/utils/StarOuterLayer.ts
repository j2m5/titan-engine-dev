import { DoubleSide, Mesh, NormalBlending, ShaderMaterial, UniformsUtils, type BufferGeometry } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'
import { UpdateContext } from '@/core/UpdateContext'
import { buildStarPalette, StarPalette } from '@/core/materials/shaders/lib/helpers'
import { buildProminenceGeometry } from '@/core/renderables/utils/prominenceGeometry'

/**
 * Петлевые протуберанцы звезды: ленты-дуги, растущие из поверхности группами
 * и гаснущие по мере роста. Геометрию строит buildProminenceGeometry, вид —
 * StarOuterLayerShaderTemplate; здесь только материал, палитра и время.
 */
class StarOuterLayer extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly radius: number

  public constructor(model: Actor) {
    super()
    this.model = model

    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)

    this.__setup()
  }

  __setup(): void {
    // Ленты строятся на единичной сфере — мировой размер даёт scale ниже
    this.geometry = buildProminenceGeometry()

    // Юниформы клонируются: шаблонные объекты общие на модуль, а палитра
    // пер-звёздная (двойная система с разными температурами)
    this.material = new ShaderMaterial({
      vertexShader: StarOuterLayerShaderTemplate.vertexShader,
      fragmentShader: StarOuterLayerShaderTemplate.fragmentShader,
      uniforms: UniformsUtils.clone(StarOuterLayerShaderTemplate.uniforms),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending
    })

    const temperature: number = this.model.physicalObject?.getAttribute('temperature', 3000) ?? 3000
    const palette: StarPalette = buildStarPalette(temperature, 1500)
    this.material.uniforms.uColorCool.value.setRGB(palette.cool.r, palette.cool.g, palette.cool.b)
    this.material.uniforms.uColorBase.value.setRGB(palette.base.r, palette.base.g, palette.base.b)

    // Атрибута position у лент нет — three нечем посчитать bounding sphere,
    // поэтому отсечение по фрустуму выключено
    this.frustumCulled = false
    this.scale.multiplyScalar(this.radius)
  }

  public updateObject(ctx: UpdateContext): void {
    this.material.uniforms.uTime.value = ctx.elapsed * 0.009
  }
}

export { StarOuterLayer }
