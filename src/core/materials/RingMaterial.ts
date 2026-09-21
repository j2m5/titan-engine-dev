import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { Color, DoubleSide, Uniform } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { RingShader } from '@/core/materials/shaders/RingShader'
import { resolveLightTint } from '@/core/helpers/lightSource'

class RingMaterial extends AbstractShaderMaterial {
  public model: Actor

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super(parameters)
    this.model = model

    const { uniforms, vertexShader, fragmentShader } = new RingShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.side = DoubleSide
    this.transparent = true
    this.depthWrite = false

    // Цвет света звезды (lightTint) — юниформ материала (RingShader его не
    // несёт); резолвер сам поднимается от актора кольца к корню дерева.
    this.uniforms.uLightColor = new Uniform(new Color(1, 1, 1))
    const lightTint = resolveLightTint(model)
    ;(this.uniforms.uLightColor.value as Color).copy(lightTint.color)
    this.defines = { ...(lightTint.active && { USE_LIGHT_TINT: '1' }) }
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { RingMaterial }
