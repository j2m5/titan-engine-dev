import { asteroidShapeFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidShape'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('AsteroidShape GLSL chunk', () => {
  it('определяет хеш, fbm-градиент и деформацию вершины', () => {
    for (const fn of ['float hash13(vec3', 'vec4 fbmGrad(vec3', 'void deformAsteroid(']) {
      expect(asteroidShapeFunctions).toContain(fn)
    }
  })

  it('деформация опирается на производный шум и смещение вдоль нормали', () => {
    expect(asteroidShapeFunctions).toContain('snoiseGrad(')
    expect(asteroidShapeFunctions).toContain('uShapeAmp')
    expect(asteroidShapeFunctions).toContain('uShapeFreq')
  })

  it('зарегистрирован в AppShaderChunk для резолва #include', () => {
    expect(AppShaderChunk.asteroidShapeFunctions).toBe(asteroidShapeFunctions)
  })
})
