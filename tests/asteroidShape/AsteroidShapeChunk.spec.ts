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
    expect(asteroidShapeFunctions).toContain('uShapeFreq')
  })

  it('амплитуда — параметр функции (per-instance), а не глобальный юниформ', () => {
    // deformAsteroid принимает amp аргументом → развязан от uShapeAmp*,
    // амплитуда задаётся per-instance во включающем шейдере
    expect(asteroidShapeFunctions).toContain('float amp')
    expect(asteroidShapeFunctions).not.toContain('uShapeAmp')
  })

  it('форму больше не несёт эллипсоид/ударные бассейны — это задача запечённого архетипа', () => {
    // Task 4 плана 2a: деформация стала остаточной (декоррелятор повторов
    // архетипов), эллипсоид и ударные бассейны удалены целиком
    for (const token of ['axes', 'basin', 'eNormal', 'ePos']) {
      expect(asteroidShapeFunctions).not.toContain(token)
    }
    // fbm-градиент и мягкий кламп тангенциального возмущения нормали остаются
    expect(asteroidShapeFunctions).toContain('fbmGrad(')
    expect(asteroidShapeFunctions).toContain('gTangent')
  })

  it('зарегистрирован в AppShaderChunk для резолва #include', () => {
    expect(AppShaderChunk.asteroidShapeFunctions).toBe(asteroidShapeFunctions)
  })
})
