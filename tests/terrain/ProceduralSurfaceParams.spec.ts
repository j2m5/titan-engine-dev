import { describe, expect, it } from 'vitest'
import { seedOffset, validateProceduralSurface } from '@/core/terrain/proceduralSurfaceParams'

const valid = {
  seed: 42, frequencyPerRadius: 3, octaves: 6, gain: 0.5, lacunarity: 2,
  contrast: 1.2, palette: ['#2a1a1a', '#5a2c24', '#8a4a33', '#c9a07a'], albedoNoise: 0.3
}

describe('validateProceduralSurface', () => {
  it('валидный объект возвращается типизированным как есть', () => {
    expect(validateProceduralSurface(valid, 'Korriban I')).toEqual(valid)
  })

  it('нецелый сид, октавы < 1, палитра не из 4 и не-hex цвет — громкие ошибки с контекстом', () => {
    expect(() => validateProceduralSurface({ ...valid, seed: 1.5 }, 'X')).toThrow(/X.*seed/)
    expect(() => validateProceduralSurface({ ...valid, octaves: 0 }, 'X')).toThrow(/octaves/)
    expect(() => validateProceduralSurface({ ...valid, palette: ['#fff'] }, 'X')).toThrow(/palette/)
    expect(() => validateProceduralSurface({ ...valid, palette: ['x', '#222222', '#333333', '#444444'] }, 'X')).toThrow(/palette/)
  })

  it('октавы > MAX_FIELD_OCTAVES (12) отвергаются: контракт с GPU-циклом', () => {
    expect(() => validateProceduralSurface({ ...valid, octaves: 13 }, 'test')).toThrow(/octaves/)
  })

  it('gain ⩽ 0 отвергается: отрицательный gain может занулить норму Σgainᵏ → NaN-поле молча', () => {
    expect(() => validateProceduralSurface({ ...valid, gain: 0 }, 'test')).toThrow(/gain/)
  })

  it('lacunarity ⩽ 0 отвергается', () => {
    expect(() => validateProceduralSurface({ ...valid, lacunarity: -1 }, 'test')).toThrow(/lacunarity/)
  })
})

describe('seedOffset', () => {
  it('детерминирован и разносит соседние сиды далеко (декорреляция доменов)', () => {
    const a = seedOffset(42)
    expect(seedOffset(42)).toEqual(a)
    const b = seedOffset(43)
    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    expect(dist).toBeGreaterThan(10)
  })
})
