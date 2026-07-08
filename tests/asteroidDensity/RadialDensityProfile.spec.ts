import { RadialDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/RadialDensityProfile'

/** Эталон равномерного по площади семплинга: r = sqrt(lerp(r0², r1², u)) */
const uniformByArea = (r0: number, r1: number, u: number): number => Math.sqrt(r0 * r0 + u * (r1 * r1 - r0 * r0))

describe('RadialDensityProfile: вес полосы (weightForBand)', () => {
  it('равномерная альфа 1 → вес 1 на любой полосе', () => {
    const profile = new RadialDensityProfile(new Float32Array(64).fill(1), 100, 200)
    expect(profile.weightForBand(100, 200)).toBeCloseTo(1, 10)
    expect(profile.weightForBand(120, 130)).toBeCloseTo(1, 10)
  })

  it('равномерная альфа 0.25 → вес 0.25 (средняя альфа полосы)', () => {
    const profile = new RadialDensityProfile(new Float32Array(64).fill(0.25), 100, 200)
    expect(profile.weightForBand(100, 200)).toBeCloseTo(0.25, 10)
  })

  it('пустотная полоса (альфа 0) → вес 0 → сектор не генерится', () => {
    // Первая половина радиусов непрозрачна, вторая — пустота
    const alpha = new Float32Array(64).fill(0)
    alpha.fill(1, 0, 32)
    const profile = new RadialDensityProfile(alpha, 100, 200)
    expect(profile.weightForBand(150, 200)).toBe(0)
    expect(profile.weightForBand(100, 150)).toBeCloseTo(1, 10)
  })

  it('вес взвешен по площади (r·dr), а не по радиусу линейно', () => {
    // Альфа 1 только на внешней половине: вес всего кольца = доля ПЛОЩАДИ внешней половины
    const alpha = new Float32Array(64).fill(0)
    alpha.fill(1, 32, 64)
    const profile = new RadialDensityProfile(alpha, 100, 200)
    const outerArea = 200 * 200 - 150 * 150
    const fullArea = 200 * 200 - 100 * 100
    expect(profile.weightForBand(100, 200)).toBeCloseTo(outerArea / fullArea, 10)
  })

  it('границы полосы клампятся в диапазон профиля', () => {
    const profile = new RadialDensityProfile(new Float32Array(8).fill(1), 100, 200)
    expect(profile.weightForBand(50, 250)).toBeCloseTo(1, 10)
  })
})

describe('RadialDensityProfile: семплинг радиуса (sampleRadius)', () => {
  it('равномерная альфа → эквивалент равномерного по площади семплинга', () => {
    const profile = new RadialDensityProfile(new Float32Array(64).fill(1), 100, 200)
    for (const u of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
      expect(profile.sampleRadius(100, 200, u)).toBeCloseTo(uniformByArea(100, 200, u), 6)
      // ... и на под-полосе сектора тоже
      expect(profile.sampleRadius(130, 170, u)).toBeCloseTo(uniformByArea(130, 170, u), 6)
    }
  })

  it('камни не попадают в пустотные бины (концентрация в колечках)', () => {
    // Узкое колечко: альфа 1 только на [125, 150], вокруг пустота
    const alpha = new Float32Array(100).fill(0)
    alpha.fill(1, 25, 50)
    const profile = new RadialDensityProfile(alpha, 100, 200)
    for (let i = 0; i < 200; i++) {
      const r = profile.sampleRadius(100, 200, i / 200)
      expect(r).toBeGreaterThanOrEqual(125)
      expect(r).toBeLessThanOrEqual(150)
    }
  })

  it('монотонен по u и остаётся внутри запрошенной полосы', () => {
    const alpha = new Float32Array(64).map((_, i) => (i % 7 === 0 ? 0 : Math.abs(Math.sin(i))))
    const profile = new RadialDensityProfile(alpha, 100, 200)
    let prev = -Infinity
    for (let i = 0; i <= 100; i++) {
      const r = profile.sampleRadius(110, 190, i / 100)
      expect(r).toBeGreaterThanOrEqual(110)
      expect(r).toBeLessThanOrEqual(190)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
  })

  it('полоса без массы → fallback равномерно по площади (не NaN/Infinity)', () => {
    const alpha = new Float32Array(64).fill(0)
    alpha.fill(1, 0, 8)
    const profile = new RadialDensityProfile(alpha, 100, 200)
    // Полоса [180, 200] целиком в пустоте
    expect(profile.sampleRadius(180, 200, 0.5)).toBeCloseTo(uniformByArea(180, 200, 0.5), 6)
  })

  it('u=1 (краевой float) не даёт вылет за полосу и не делит на ноль', () => {
    // Хвост профиля пустой: масса заканчивается до maxRadius полосы
    const alpha = new Float32Array(64).fill(1)
    alpha.fill(0, 48)
    const profile = new RadialDensityProfile(alpha, 100, 200)
    const r = profile.sampleRadius(100, 200, 1)
    expect(Number.isFinite(r)).toBe(true)
    expect(r).toBeGreaterThanOrEqual(100)
    expect(r).toBeLessThanOrEqual(200)
  })

  it('распределение следует альфе: доля камней в бине ∝ α·площадь', () => {
    // Внутренняя половина α=1, внешняя α=0.5 → доли масс по формуле ∫α·r dr
    const alpha = new Float32Array(64).fill(0.5)
    alpha.fill(1, 0, 32)
    const profile = new RadialDensityProfile(alpha, 100, 200)
    const innerMass = 1.0 * (150 * 150 - 100 * 100)
    const outerMass = 0.5 * (200 * 200 - 150 * 150)
    const expectedInnerShare = innerMass / (innerMass + outerMass)

    const samples = 10000
    let innerHits = 0
    for (let i = 0; i < samples; i++) {
      if (profile.sampleRadius(100, 200, (i + 0.5) / samples) < 150) innerHits++
    }
    expect(innerHits / samples).toBeCloseTo(expectedInnerShare, 2)
  })
})

describe('RadialDensityProfile: валидация конструктора', () => {
  it('пустой профиль или вырожденные радиусы → ошибка', () => {
    expect(() => new RadialDensityProfile(new Float32Array(0), 100, 200)).toThrow()
    expect(() => new RadialDensityProfile(new Float32Array(4).fill(1), 200, 100)).toThrow()
    expect(() => new RadialDensityProfile(new Float32Array(4).fill(1), 100, 100)).toThrow()
  })
})
