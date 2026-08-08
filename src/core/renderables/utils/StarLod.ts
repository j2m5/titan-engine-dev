import { WebGLRenderer } from 'three'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { STAR_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'

/**
 * LOD звезды: ApparentSizeLod с зашитым размером импостора.
 *
 * Отдельный класс, а не прямой вызов ApparentSizeLod на стороне фабрики:
 * STAR_IMPOSTOR_PIXELS — не параметр вызова, а часть контракта звезды, по
 * которому сведён стык LOD, и вызывающей стороне нечем его подменить. Тот же
 * приём, что у starLodSwitchDistance.
 */
class StarLod extends ApparentSizeLod {
  public constructor(radiusKm: number, renderer: WebGLRenderer) {
    super(radiusKm, renderer, STAR_IMPOSTOR_PIXELS)
  }
}

export { StarLod }
