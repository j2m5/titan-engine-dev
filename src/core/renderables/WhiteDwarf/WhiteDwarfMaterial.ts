import { ShaderMaterial, UniformsUtils } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { WhiteDwarfShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfShaderTemplate'
import {
  WhiteDwarfParameters,
  WHITE_DWARF_DISPLAY_SCALE
} from '@/core/renderables/WhiteDwarf/WhiteDwarfParameters'
import {
  colorTemperatureToRGB,
  normalizeColor,
  planckX,
  srgbColorToLinear,
  visibleBandRadianceRatio,
  STAR_CORE_INTENSITY
} from '@/core/materials/shaders/lib/helpers'
import { Colorable } from '@/core/models/types'

/**
 * Материал тела карлика.
 *
 * Юниформы клонируются: шаблонные объекты общие на модуль, а температура
 * пер-объектная (Sirius B и G29-38 стоят в одной сборке).
 *
 * Все три юниформа — функции ОДНОЙ величины, температуры. Развести их между
 * собой нельзя по построению, и это главное свойство материала: тела, у
 * которого цвет не соответствует яркости, здесь не получить.
 *
 * Палитры из трёх точек, как у звезды и коричневого карлика, тут нет: смешивать
 * не между чем, поверхность однородна.
 */
class WhiteDwarfMaterial extends ShaderMaterial {
  public constructor(params: WhiteDwarfParameters) {
    super({
      vertexShader: AbstractShader.prepareSource(WhiteDwarfShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(WhiteDwarfShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(WhiteDwarfShaderTemplate.uniforms)
    })

    const base: Colorable = srgbColorToLinear(normalizeColor(colorTemperatureToRGB(params.temperature)))

    this.uniforms.uColorBase.value.setRGB(base.r, base.g, base.b)
    this.uniforms.uPlanckX.value.fromArray(planckX(params.temperature))
    // Яркость в ВИДИМОЙ полосе, а не по Стефану-Больцману: болометрический T^4
    // у карлика почти весь в EUV и завысил бы уровень в разы (см.
    // visibleBandRadianceRatio). Дальше честный уровень сажается в HDR-коридор
    // движка через WHITE_DWARF_DISPLAY_SCALE — иначе блум заливает кадр белым.
    // Точка отката — exposureBias = 0
    this.uniforms.uCoreIntensity.value =
      STAR_CORE_INTENSITY *
      visibleBandRadianceRatio(params.temperature) *
      WHITE_DWARF_DISPLAY_SCALE *
      params.exposureBias
  }
}

export { WhiteDwarfMaterial }
