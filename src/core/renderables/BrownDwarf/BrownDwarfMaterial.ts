import { ShaderMaterial, UniformsUtils } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'
import {
  BrownDwarfParameters,
  BROWN_DWARF_CLOUD_DIM,
  BROWN_DWARF_DECK_PLUM,
  BROWN_DWARF_PALETTE_SPREAD_K
} from '@/core/renderables/BrownDwarf/BrownDwarfParameters'
import { buildStarPalette, mixColor, StarPalette } from '@/core/materials/shaders/lib/helpers'
import { Colorable } from '@/core/models/types'

/**
 * Материал тела карлика.
 *
 * Юниформы клонируются: шаблонные объекты общие на модуль, а палитра
 * пер-объектная (в одной сцене могут стоять карлики разной температуры).
 * Поле облаков считается в шейдере аналитически (bdField) — сюда идут только
 * его числовые параметры.
 */
class BrownDwarfMaterial extends ShaderMaterial {
  public constructor(params: BrownDwarfParameters) {
    super({
      vertexShader: AbstractShader.prepareSource(BrownDwarfShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(BrownDwarfShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(BrownDwarfShaderTemplate.uniforms)
    })

    const palette: StarPalette = buildStarPalette(params.temperature, BROWN_DWARF_PALETTE_SPREAD_K)
    // Ядро глубокой прогалины вдвое дальше по шкале, чем обычный hot —
    // отсюда градиент к центру открытого разрыва палубы
    const paletteDeep: StarPalette = buildStarPalette(params.temperature, BROWN_DWARF_PALETTE_SPREAD_K * 2)

    this.uniforms.uColorHot.value.setRGB(palette.hot.r, palette.hot.g, palette.hot.b)
    this.uniforms.uColorHotDeep.value.setRGB(paletteDeep.hot.r, paletteDeep.hot.g, paletteDeep.hot.b)

    // Тонировка ложится на хроматичность ДО затемнения, поэтому обе записи
    // палубы получают один цвет при разной яркости. Только палуба: прогалины
    // остаются планковскими, и тон разводит их с палубой сильнее, чем
    // разводила одна светлота
    const deck: Colorable = mixColor(palette.cool, BROWN_DWARF_DECK_PLUM, params.deckTint)

    this.uniforms.uColorCloud.value.setRGB(
      deck.r * BROWN_DWARF_CLOUD_DIM,
      deck.g * BROWN_DWARF_CLOUD_DIM,
      deck.b * BROWN_DWARF_CLOUD_DIM
    )
    // Верхушки холоднее и темнее нижней палубы: тот же цвет, затемнён вдвое сильнее
    this.uniforms.uColorCloudHigh.value.setRGB(
      deck.r * BROWN_DWARF_CLOUD_DIM * 0.45,
      deck.g * BROWN_DWARF_CLOUD_DIM * 0.45,
      deck.b * BROWN_DWARF_CLOUD_DIM * 0.45
    )
    this.uniforms.uOpticalDepth.value = params.opticalDepth
    this.uniforms.uGapGlow.value = params.gapGlow
    this.uniforms.uLimbDarkening.value = params.limbDarkening
    this.uniforms.uGapThreshold.value = params.gapThreshold
    this.uniforms.uDeckSoftness.value = params.deckSoftness
    this.uniforms.uParallax.value = params.parallax
    this.uniforms.uBreathAmplitude.value = params.breathAmplitude
    this.uniforms.uSeed.value = params.seed
    this.uniforms.uBandCount.value = params.bandCount
    this.uniforms.uTurbulence.value = params.turbulence
    this.uniforms.uBandWarp.value = params.bandWarp
    this.uniforms.uZonalShear.value = params.zonalShear
    this.uniforms.uFineDetail.value = params.fineDetail
    this.uniforms.uPolarChaos.value = params.polarChaos
    this.uniforms.uVortexStrength.value = params.vortexStrength
  }
}

export { BrownDwarfMaterial }
