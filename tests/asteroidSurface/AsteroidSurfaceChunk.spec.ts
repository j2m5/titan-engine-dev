import { asteroidSurfaceFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidSurface'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('AsteroidSurface GLSL chunk (v2 профили)', () => {
  it('единый базовый цвет: applyAsteroidSurface принимает baseColor, без 3-типового rockBaseColor', () => {
    expect(asteroidSurfaceFunctions).toContain('vec3 applyAsteroidSurface(')
    expect(asteroidSurfaceFunctions).toContain('vec3 baseColor')
    expect(asteroidSurfaceFunctions).not.toContain('rockBaseColor')
    expect(asteroidSurfaceFunctions).not.toContain('sCol')
  })

  it('добавлен слой микрозерна и texture-free возмущение нормали', () => {
    expect(asteroidSurfaceFunctions).toContain('grainStrength')
    expect(asteroidSurfaceFunctions).toContain('vec3 perturbNormalFromHeight(')
  })

  it('кратеры/трещины по-прежнему из worleyCell', () => {
    expect(asteroidSurfaceFunctions).toContain('worleyCell(')
  })

  it('зарегистрирован в AppShaderChunk', () => {
    expect(AppShaderChunk.asteroidSurfaceFunctions).toBe(asteroidSurfaceFunctions)
  })
})
