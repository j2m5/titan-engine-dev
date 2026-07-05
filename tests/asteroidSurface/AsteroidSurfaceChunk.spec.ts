import { asteroidSurfaceFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidSurface'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('AsteroidSurface GLSL chunk', () => {
  it('определяет функции слоёв и композитор', () => {
    for (const fn of ['float hashSurface11(', 'vec3 rockBaseColor(', 'float craterProfile(', 'vec3 applyAsteroidSurface(']) {
      expect(asteroidSurfaceFunctions).toContain(fn)
    }
  })

  it('кратеры/трещины опираются на расширенный Worley', () => {
    expect(asteroidSurfaceFunctions).toContain('worleyCell(')
  })

  it('зарегистрирован в AppShaderChunk для резолва #include', () => {
    expect(AppShaderChunk.asteroidSurfaceFunctions).toBe(asteroidSurfaceFunctions)
  })
})
