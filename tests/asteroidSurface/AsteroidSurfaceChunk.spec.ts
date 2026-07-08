import { asteroidSurfaceFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidSurface'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('AsteroidSurface GLSL chunk (аналитические нормали)', () => {
  it('единый базовый цвет: applyAsteroidSurface принимает baseColor, без 3-типового rockBaseColor', () => {
    expect(asteroidSurfaceFunctions).toContain('vec3 applyAsteroidSurface(')
    expect(asteroidSurfaceFunctions).toContain('vec3 baseColor')
    expect(asteroidSurfaceFunctions).not.toContain('rockBaseColor')
    expect(asteroidSurfaceFunctions).not.toContain('sCol')
  })

  it('нормаль из АНАЛИТИЧЕСКОГО градиента кратеров (craterProfileD), не из dFdx', () => {
    expect(asteroidSurfaceFunctions).toContain('float craterProfileD(') // производная профиля кратера
    expect(asteroidSurfaceFunctions).toContain('out vec3 perturbedNormal')
    expect(asteroidSurfaceFunctions).toContain('gradH')                 // накопитель градиента нормали
    // Конечно-разностный путь убран
    expect(asteroidSurfaceFunctions).not.toContain('perturbNormalFromHeight')
  })

  it('кратеры по-прежнему из worleyCell; процедурное зерно/трещины убраны', () => {
    expect(asteroidSurfaceFunctions).toContain('worleyCell(')
    expect(asteroidSurfaceFunctions).not.toContain('snoiseGrad(')
    expect(asteroidSurfaceFunctions).not.toContain('crackWidth')
    expect(asteroidSurfaceFunctions).not.toContain('grainStrength')
  })

  it('зарегистрирован в AppShaderChunk', () => {
    expect(AppShaderChunk.asteroidSurfaceFunctions).toBe(asteroidSurfaceFunctions)
  })
})
