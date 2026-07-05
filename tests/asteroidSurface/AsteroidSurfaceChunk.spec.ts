import { asteroidSurfaceFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidSurface'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('AsteroidSurface GLSL chunk (аналитические нормали)', () => {
  it('единый базовый цвет: applyAsteroidSurface принимает baseColor, без 3-типового rockBaseColor', () => {
    expect(asteroidSurfaceFunctions).toContain('vec3 applyAsteroidSurface(')
    expect(asteroidSurfaceFunctions).toContain('vec3 baseColor')
    expect(asteroidSurfaceFunctions).not.toContain('rockBaseColor')
    expect(asteroidSurfaceFunctions).not.toContain('sCol')
  })

  it('нормаль из АНАЛИТИЧЕСКИХ градиентов (snoiseGrad + craterProfileD), не из dFdx', () => {
    expect(asteroidSurfaceFunctions).toContain('snoiseGrad(')           // зерно аналитически
    expect(asteroidSurfaceFunctions).toContain('float craterProfileD(') // производная профиля кратера
    expect(asteroidSurfaceFunctions).toContain('out vec3 perturbedNormal')
    expect(asteroidSurfaceFunctions).toContain('gradH')                 // накопитель градиента нормали
    // Конечно-разностный путь убран
    expect(asteroidSurfaceFunctions).not.toContain('perturbNormalFromHeight')
  })

  it('кратеры/трещины по-прежнему из worleyCell', () => {
    expect(asteroidSurfaceFunctions).toContain('worleyCell(')
  })

  it('зарегистрирован в AppShaderChunk', () => {
    expect(AppShaderChunk.asteroidSurfaceFunctions).toBe(asteroidSurfaceFunctions)
  })
})
