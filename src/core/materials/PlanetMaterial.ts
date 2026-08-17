import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { Actor } from '@/core/models/Actor'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Texture } from 'three'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'

class PlanetMaterial extends AbstractShaderMaterial {
  public model: Actor

  /**
   * Снимок дефайнов, поставленных шейдером при конструировании (тень колец).
   *
   * `updateMaterial` пересобирает набор дефайнов от этого снимка, а не поверх
   * прошлого состояния. Накопление (`{ ...this.defines, ... }`) не умело
   * СНИМАТЬ дефайн: ложный spread — это no-op, поэтому карта, вытесненная
   * стримером, оставляла свой `#define` включённым навсегда. Шейдер продолжал
   * сэмплить сэмплер, в который three подставляет пустую чёрную текстуру, и
   * декод читал из неё мусор вместо признания «карты нет».
   */
  private readonly baseDefines: Record<string, unknown>

  public constructor(model: Actor, parameters?: ShaderMaterialParameters) {
    super(parameters)
    this.model = model

    const { uniforms, defines, vertexShader, fragmentShader } = new PlanetShader(this.model)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines
    this.baseDefines = { ...defines }
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
    const textureOf = (
      type: 'slope' | 'bump' | 'detailDiffuse' | 'detailNormal' | 'detailArm' | 'detailNormal2'
    ): Texture | undefined => {
      const path = this.model.resources.where('resourceType', type).first()?.getAttribute('path')

      return typeof path === 'string' ? resourceStorage.getTexture(path) : undefined
    }
    const slopeMap = textureOf('slope')
    const legacyBumpMap = textureOf('bump')
    const bumpMap: Texture | undefined = hasHeightField ? slopeMap : legacyBumpMap

    // Терраформный детальный слой (задача 4, чанк TerrainDetail): крупная
    // нормаль — база слоя, её наличие и есть условие USE_TERRAIN_DETAIL.
    // AO/diffuse/мелкая нормаль опциональны — гейтятся рантайм-юниформом
    // uDetailLayerGates, а не #ifdef, чтобы не требовать перекомпиляции
    // программы при догрузке отдельной карты.
    const detailNorMap = textureOf('detailNormal')
    const detailDiffMap = textureOf('detailDiffuse')
    const detailArmMap = textureOf('detailArm')
    const detailNor2Map = textureOf('detailNormal2')
    const USE_TERRAIN_DETAIL = hasHeightField && Boolean(detailNorMap)

    this.uniforms.diffuseMap.value = diffuseMap
    this.uniforms.nightMap.value = nightMap
    this.uniforms.cloudMap.value = cloudMap
    this.uniforms.specularMap.value = specularMap
    this.uniforms.bumpMap.value = bumpMap

    this.uniforms.uDetailNorMap.value = detailNorMap ?? null
    this.uniforms.uDetailDiffMap.value = detailDiffMap ?? null
    this.uniforms.uDetailArmMap.value = detailArmMap ?? null
    this.uniforms.uDetailNor2Map.value = detailNor2Map ?? null
    this.uniforms.uDetailLayerGates.value.set(detailArmMap ? 1 : 0, detailDiffMap ? 1 : 0, detailNor2Map ? 1 : 0)

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

    // Набор собирается от снимка конструирования, а не поверх прошлого: только
    // так дефайн ушедшей карты исчезает вместе с ней (см. baseDefines).
    this.defines = {
      ...this.baseDefines,
      ...(useClassicBump && { USE_BUMP: '1' }),
      ...(hasHeightField && slopeMap && { USE_SLOPE: '1' }),
      // Попиксельный UV из направления вместо вершинного vUv — вершинная
      // развёртка кубосферы вырождается у полюсов (см. PlanetShaderTemplate).
      // Тот же реестр карт высот, что решает геометрию TerrainSphere.
      ...(hasHeightField && { USE_TERRAIN_UV: '1' }),
      ...(USE_TERRAIN_DETAIL && { USE_TERRAIN_DETAIL: '1' }),
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

    this.uniforms.uDetailNorMap.value = null
    this.uniforms.uDetailDiffMap.value = null
    this.uniforms.uDetailArmMap.value = null
    this.uniforms.uDetailNor2Map.value = null
    this.uniforms.uDetailLayerGates.value.set(0, 0, 0)

    // Возврат к состоянию «карт нет» — это и есть снимок конструирования:
    // поимённый список дефайнов пришлось бы держать в синхроне вручную при
    // каждом новом слое карт.
    this.defines = { ...this.baseDefines }

    this.needsUpdate = true
  }
}

export { PlanetMaterial }
