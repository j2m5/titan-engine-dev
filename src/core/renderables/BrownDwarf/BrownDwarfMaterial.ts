import { CubeTexture, ShaderMaterial, UniformsUtils } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'
import { BrownDwarfParameters, BROWN_DWARF_CLOUD_DIM, BROWN_DWARF_PALETTE_SPREAD_K } from '@/core/renderables/BrownDwarf/BrownDwarfParameters'
import { buildStarPalette, StarPalette } from '@/core/materials/shaders/lib/helpers'

/**
 * Материал тела карлика.
 *
 * Юниформы клонируются: шаблонные объекты общие на модуль, а палитра
 * пер-объектная (в одной сцене могут стоять карлики разной температуры).
 */
class BrownDwarfMaterial extends ShaderMaterial {
  public constructor(params: BrownDwarfParameters, clouds: CubeTexture) {
    super({
      vertexShader: AbstractShader.prepareSource(BrownDwarfShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(BrownDwarfShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(BrownDwarfShaderTemplate.uniforms)
    })

    const palette: StarPalette = buildStarPalette(params.temperature, BROWN_DWARF_PALETTE_SPREAD_K)

    this.uniforms.uClouds.value = clouds
    this.uniforms.uColorHot.value.setRGB(palette.hot.r, palette.hot.g, palette.hot.b)
    this.uniforms.uColorCloud.value.setRGB(
      palette.cool.r * BROWN_DWARF_CLOUD_DIM,
      palette.cool.g * BROWN_DWARF_CLOUD_DIM,
      palette.cool.b * BROWN_DWARF_CLOUD_DIM
    )
    this.uniforms.uOpticalDepth.value = params.opticalDepth
    this.uniforms.uGapGlow.value = params.gapGlow
    this.uniforms.uParallax.value = params.parallax
    this.uniforms.uBreathAmplitude.value = params.breathAmplitude
  }
}

export { BrownDwarfMaterial }
