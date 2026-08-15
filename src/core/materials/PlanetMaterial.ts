import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { RepeatWrapping, Texture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'

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
      this.model.resources.where('resourceType', 'diffuse').first()?.getAttribute('path') ?? ''
    )
    const nightMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'night').first()?.getAttribute('path') ?? ''
    )
    const cloudMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'cloud').first()?.getAttribute('path') ?? ''
    )
    const specularMap: Texture | undefined = resourceStorage.getTexture(
      this.model.resources.where('resourceType', 'specular').first()?.getAttribute('path') ?? ''
    )
    // Рельефный шейдинг сверяется с фактически загруженной картой высот — тем
    // же реестром, по которому Planet строил геометрию. Строка БД тут не
    // авторитет: если карта не доехала (HeightFieldStorage предупредил и
    // пропустил), сфера гладкая, и кратерный slope-шейдинг на ней был бы
    // враньём — тогда рельефные дефайны молчат целиком.
    const heightPath = this.model.resources.where('resourceType', 'height').first()?.getAttribute('path')
    const hasHeightField = typeof heightPath === 'string' && Boolean(heightFieldStorage.get(heightPath))

    // slope-карта — уклоны из той же карты высот (см. slopeMapFormat): шейдит
    // попиксельно то, что не влезло в вершинную сетку, мипы фильтруют издалека.
    // Классический bump живёт только у тел без честного рельефа.
    //
    // Отсутствие строки ресурса — undefined, а не запрос по '': в хранилище
    // живёт плейсхолдер с пустым именем (getTextureOrMake('') у колец), и
    // фолбэк на '' находил бы его как фантомную карту рельефа.
    const textureOf = (type: 'slope' | 'bump'): Texture | undefined => {
      const path = this.model.resources.where('resourceType', type).first()?.getAttribute('path')

      return typeof path === 'string' ? resourceStorage.getTexture(path) : undefined
    }
    const slopeMap = textureOf('slope')
    const legacyBumpMap = textureOf('bump')
    const bumpMap: Texture | undefined = hasHeightField ? slopeMap : legacyBumpMap

    this.uniforms.diffuseMap.value = diffuseMap
    this.uniforms.nightMap.value = nightMap
    this.uniforms.cloudMap.value = cloudMap
    this.uniforms.specularMap.value = specularMap
    this.uniforms.bumpMap.value = bumpMap

    // UV кубосферы разворачивает шов за пределы [0,1] — аппаратный wrap вместо
    // fract() в шейдере (и заодно уходит мип-полоса на шве). Только терраформным
    // телам: у прочих развёртка сферы в [0,1] и ClampToEdge остаётся.
    if (hasHeightField) {
      for (const texture of [diffuseMap, slopeMap]) {
        if (texture && texture.wrapS !== RepeatWrapping) {
          texture.wrapS = RepeatWrapping
          texture.needsUpdate = true
        }
      }
    }

    // Шаг выборки соседних текселей для аналитического градиента нормали —
    // атрибут четырёхвыборочного bump-пути; slope-путь читает одну выборку.
    // Нули = рельеф выключен: все четыре выборки совпадают, градиент нулевой —
    // безопасное поведение, пока карта не загружена.
    const bumpImage = bumpMap?.image as { width?: number; height?: number } | undefined
    const useClassicBump = !hasHeightField && Boolean(legacyBumpMap)
    this.uniforms.uBumpTexelSize.value.set(
      useClassicBump && bumpImage?.width ? 1 / bumpImage.width : 0,
      useClassicBump && bumpImage?.height ? 1 / bumpImage.height : 0
    )

    this.defines = {
      ...this.defines,
      ...(useClassicBump && { USE_BUMP: '1' }),
      ...(hasHeightField && slopeMap && { USE_SLOPE: '1' }),
      // Попиксельный UV из направления вместо вершинного vUv — вершинная
      // развёртка кубосферы вырождается у полюсов (см. PlanetShaderTemplate).
      // Тот же реестр карт высот, что решает геометрию TerrainSphere.
      ...(hasHeightField && { USE_TERRAIN_UV: '1' }),
      ...(specularMap && { USE_SPECULAR: '1' }),
      ...(nightMap && { USE_NIGHT: '1' }),
      ...(cloudMap && { USE_CLOUD: '1' })
    }

    this.needsUpdate = true
  }

  public resetMaterial(): void {
    this.uniforms.diffuseMap.value = resourceStorage.getTextureOrMake('default.png')
    this.uniforms.nightMap.value = resourceStorage.getTextureOrMake('night.jpg')
    this.uniforms.cloudMap.value = null
    this.uniforms.specularMap.value = null
    this.uniforms.bumpMap.value = null
    this.uniforms.uBumpTexelSize.value.set(0, 0)

    delete this.defines.USE_BUMP
    delete this.defines.USE_SLOPE
    delete this.defines.USE_TERRAIN_UV
    delete this.defines.USE_SPECULAR
    delete this.defines.USE_NIGHT
    delete this.defines.USE_CLOUD

    this.needsUpdate = true
  }
}

export { PlanetMaterial }
