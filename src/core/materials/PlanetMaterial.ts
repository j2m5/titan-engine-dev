import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Texture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'

class PlanetMaterial extends AbstractShaderMaterial {
  public model: Actor

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super(parameters)
    this.model = model

    const { uniforms, defines, vertexShader, fragmentShader } = new PlanetShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines
  }

  public updateMaterial(): void {
    const diffuseMap: Texture = resourceStorage.getTextureOrMake(
      this.model.resources.where('resourceType', 'diffuse').first()?.getAttribute('path')
    )
    const nightMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'night').first()?.getAttribute('path')
    )
    const cloudMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'cloud').first()?.getAttribute('path')
    )
    const specularMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'specular').first()?.getAttribute('path')
    )
    const bumpMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'bump').first()?.getAttribute('path')
    )

    this.uniforms.diffuseMap.value = diffuseMap
    this.uniforms.nightMap.value = nightMap
    this.uniforms.cloudMap.value = cloudMap
    this.uniforms.specularMap.value = specularMap
    this.uniforms.bumpMap.value = bumpMap

    this.defines = {
      ...this.defines,
      ...(bumpMap && { USE_BUMP: '1' }),
      ...(specularMap && { USE_SPECULAR: '1' })
    }

    this.needsUpdate = true
  }

  public resetMaterial(): void {
    this.uniforms.diffuseMap.value = resourceStorage.getTextureOrMake('default.png')
    this.uniforms.nightMap.value = resourceStorage.getTextureOrMake('night.jpg')
    this.uniforms.cloudMap.value = null
    this.uniforms.specularMap.value = null
    this.uniforms.bumpMap.value = null

    delete this.defines.USE_BUMP
    delete this.defines.USE_SPECULAR

    this.needsUpdate = true
  }
}

export { PlanetMaterial }
