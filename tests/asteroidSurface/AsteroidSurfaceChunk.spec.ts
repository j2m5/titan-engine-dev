import { asteroidSurfaceFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidSurface'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

describe('AsteroidSurface GLSL chunk (макро-слой без кратеров)', () => {
  it('единый базовый цвет: applyAsteroidSurface принимает baseColor, без 3-типового rockBaseColor', () => {
    expect(asteroidSurfaceFunctions).toContain('vec3 applyAsteroidSurface(')
    expect(asteroidSurfaceFunctions).toContain('vec3 baseColor')
    expect(asteroidSurfaceFunctions).not.toContain('rockBaseColor')
    expect(asteroidSurfaceFunctions).not.toContain('sCol')
  })

  it('новая сигнатура: tintSeed/domainOffset приходят из ВЕРШИННИКА (анти-ULP-джиттер)', () => {
    expect(asteroidSurfaceFunctions).toContain(
      'vec3 applyAsteroidSurface(vec3 dir, float tintSeed, vec3 domainOffset, vec3 baseColor, float colorJitter, float tintStrength, float mariaStrength)'
    )
    expect(asteroidSurfaceFunctions).not.toContain('out vec3 perturbedNormal')
    expect(asteroidSurfaceFunctions).not.toContain('out float ao')
    expect(asteroidSurfaceFunctions).not.toContain('out vec3 baseAlbedo')
  })

  it('кратеры и каверн-AO убраны: craterProfile/worleyCell/gradH отсутствуют в чанке', () => {
    expect(asteroidSurfaceFunctions).not.toContain('craterProfile')
    expect(asteroidSurfaceFunctions).not.toContain('craterProfileD')
    expect(asteroidSurfaceFunctions).not.toContain('worleyCell(')
    expect(asteroidSurfaceFunctions).not.toContain('gradH')
    expect(asteroidSurfaceFunctions).not.toContain('cavity')
    expect(asteroidSurfaceFunctions).not.toContain('snoiseGrad(')
    expect(asteroidSurfaceFunctions).not.toContain('crackWidth')
    expect(asteroidSurfaceFunctions).not.toContain('grainStrength')
  })

  it('макро-слой (джиттер/мотл/maria) сохранён; hashSurface11 переехал в noiseFunctions', () => {
    // Хеш-каскад от интерполированного сида ЗАПРЕЩЁН во фрагменте: ULP-джиттер
    // varying'а усиливается градиентом хеша до пиксельного шума («сетка»).
    // Все пер-инстансные хеши считаются в вершиннике → хеш живёт в общем чанке.
    expect(asteroidSurfaceFunctions).not.toContain('float hashSurface11(')
    expect(asteroidSurfaceFunctions).not.toContain('hashSurface11(')
    expect(asteroidSurfaceFunctions).toContain('tintSeed')
    expect(asteroidSurfaceFunctions).toContain('domainOffset')
    expect(asteroidSurfaceFunctions).toContain('colorJitter')
    expect(asteroidSurfaceFunctions).toContain('mottle')
    expect(asteroidSurfaceFunctions).toContain('maria')
    expect(asteroidSurfaceFunctions).toContain('mariaStrength')
  })

  it('зарегистрирован в AppShaderChunk', () => {
    expect(AppShaderChunk.asteroidSurfaceFunctions).toBe(asteroidSurfaceFunctions)
  })
})
