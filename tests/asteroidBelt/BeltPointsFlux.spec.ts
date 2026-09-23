import { describe, it, expect } from 'vitest'
import { BeltPointsShaderTemplate } from '@/core/materials/shaders/lib/BeltPointsShaderTemplate'
import { withoutComments } from '../helpers/glsl'

/**
 * Зеркало яркости точки: доля площади честного диска в пикселе. GPU не рисует
 * спрайт меньше пикселя, поэтому тело в десятую пикселя без этого множителя
 * светило бы как полноценная точка — отсюда «россыпь» издалека.
 */
const flux = (trueSizePx: number): number => {
  const s = Math.min(Math.max(trueSizePx, 0), 1)
  return s * s
}

describe('BeltPointsShaderTemplate: точка гаснет ниже пикселя', () => {
  const vertex = withoutComments(BeltPointsShaderTemplate.vertexShader)
  const fragment = withoutComments(BeltPointsShaderTemplate.fragmentShader)

  it('честный размер считается отдельно, спрайт зажат снизу к пикселю', () => {
    expect(vertex).toContain('float trueSize = size * (uPointScale / -mvPosition.z);')
    expect(vertex).toContain('gl_PointSize = max(trueSize, 1.0);')
  })

  it('яркость — квадрат доли честного размера от пикселя, не больше единицы', () => {
    expect(vertex).toContain('float fluxSide = clamp(trueSize, 0.0, 1.0);')
    expect(vertex).toContain('vFlux = fluxSide * fluxSide;')
    expect(fragment).toContain('float alpha = vFarGate * edgeAlpha * vFlux;')
  })

  it('зеркало: десятая пикселя — сотая яркости, пиксель и крупнее — полная', () => {
    expect(flux(0.1)).toBeCloseTo(0.01, 12)
    expect(flux(0.5)).toBeCloseTo(0.25, 12)
    expect(flux(1)).toBe(1)
    expect(flux(7)).toBe(1)
    expect(flux(-2)).toBe(0)
  })
})
