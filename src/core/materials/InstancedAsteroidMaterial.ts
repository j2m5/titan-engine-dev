import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { Color, Uniform } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'
import type { Actor } from '@/core/models/Actor'
import { resolveLightTint } from '@/core/helpers/lightSource'

class InstancedAsteroidMaterial extends AbstractShaderMaterial {
  /**
   * `model` — актор кольца (единственный вызывающий с реальным телом —
   * AsteroidRingSystem через InstancePool); резолвер сам поднимается к
   * корню дерева. `undefined` — легаси-конструкторы без модели
   * (InstancedAsteroid/AsteroidCluster, сейчас не используются) — тинт
   * остаётся выключенным, как раньше.
   */
  public constructor(model?: Actor, parameters?: ShaderMaterialParameters) {
    super(parameters)

    const { uniforms, vertexShader, fragmentShader } = new InstancedAsteroidShader()

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader

    this.uniforms.uLightColor = new Uniform(new Color(1, 1, 1))
    const lightTint = model ? resolveLightTint(model) : { active: false, color: new Color(1, 1, 1) }
    ;(this.uniforms.uLightColor.value as Color).copy(lightTint.color)
    // Спред обязателен: дефайны из parameters уже лежат в this.defines после super()
    this.defines = { ...this.defines, ...(lightTint.active && { USE_LIGHT_TINT: '1' }) }
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { InstancedAsteroidMaterial }
