import { AdditiveBlending, BackSide, Texture, Vector2 } from 'three'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { NebulaUpscaleShader } from '@/core/renderables/Nebula/NebulaUpscaleShader'

class NebulaUpscaleMaterial extends AbstractShaderMaterial {
  public constructor(
    nebulaTexture: Texture | null,
    resolution: Vector2,
    materialParameters?: ShaderMaterialParameters
  ) {
    super(materialParameters)

    const { uniforms, vertexShader, fragmentShader } = new NebulaUpscaleShader(nebulaTexture, resolution)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader

    this.transparent = true
    this.depthWrite = false
    this.blending = AdditiveBlending
    this.side = BackSide
  }

  /** Привязать актуальную текстуру half-RT (на случай пересоздания при ресайзе) */
  public setTexture(texture: Texture | null): void {
    this.uniforms.uNebulaTex.value = texture
  }

  /** Обновить полное разрешение буфера (ресайз окна / скриншот-режим) */
  public setResolution(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height)
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { NebulaUpscaleMaterial }
