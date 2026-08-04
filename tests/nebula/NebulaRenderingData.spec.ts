import { describe, it, expect } from 'vitest'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { makeDefaultNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'

describe('nebulaParamsFromData — единицы и типы', () => {
  it('size приходит в а.е., а в параметрах оказывается в Three-юнитах', () => {
    const params = nebulaParamsFromData({ size: 360.11263 })

    expect(params.size).toBeCloseTo(fromAstronomicalUnits(360.11263), 6)
    // тот же литерал, что был захардкожен до миграции
    expect(params.size).toBeCloseTo(27000000, 0)
  })

  it('hex-строки становятся Color', () => {
    const params = nebulaParamsFromData({
      palette: { secondary: '#5aa0d8', stops: [{ t: 0.5, color: '#06141c' }] },
      dust: { color: '#05090c' }
    })

    expect(params.palette.secondary.getHex()).toBe(0x5aa0d8)
    expect(params.palette.stops).toHaveLength(1)
    expect(params.palette.stops[0].t).toBe(0.5)
    expect(params.palette.stops[0].color.getHex()).toBe(0x06141c)
    expect(params.dust.color.getHex()).toBe(0x05090c)
  })

  it('тройки становятся Vector3', () => {
    const params = nebulaParamsFromData({
      axisRatios: [1, 0.5, 1],
      cavities: [{ center: [0.1, 0, -0.2], radius: 0.4, strength: 0.3 }],
      lighting: { starPosition: [1, 2, 3] }
    })

    expect(params.axisRatios.toArray()).toEqual([1, 0.5, 1])
    expect(params.cavities[0].center.toArray()).toEqual([0.1, 0, -0.2])
    expect(params.cavities[0].radius).toBe(0.4)
    expect(params.cavities[0].strength).toBe(0.3)
    expect(params.lighting.starPosition?.toArray()).toEqual([1, 2, 3])
  })

  it('пустой конфиг даёт дефолты движка', () => {
    const params = nebulaParamsFromData({})
    const defaults = makeDefaultNebulaParams()

    expect(params.seed).toBe(defaults.seed)
    expect(params.shape).toBe(defaults.shape)
    expect(params.density).toBe(defaults.density)
    expect(params.noise.octaves).toBe(defaults.noise.octaves)
  })
})

describe('nebulaParamsFromData — слои preset и overrides', () => {
  it('preset ложится под дефолты, меняя их', () => {
    const params = nebulaParamsFromData({ preset: 'dark' })

    // NEBULA_PRESETS.dark: dust.strength 0.9, threshold 0.4
    expect(params.dust.strength).toBeCloseTo(0.9)
    expect(params.dust.threshold).toBeCloseTo(0.4)
  })

  it('поля data перебивают preset', () => {
    const params = nebulaParamsFromData({ preset: 'dark', dust: { strength: 0.2 } })

    expect(params.dust.strength).toBeCloseTo(0.2)
    // не заданное в data поле preset сохраняется
    expect(params.dust.threshold).toBeCloseTo(0.4)
  })

  it('без preset берутся чистые дефолты', () => {
    const params = nebulaParamsFromData({})

    expect(params.dust.strength).toBeCloseTo(makeDefaultNebulaParams().dust.strength)
  })
})

describe('nebulaParamsFromData — клампы движка не обходятся', () => {
  it('maxSteps зажимается в допустимый диапазон', () => {
    expect(nebulaParamsFromData({ quality: { maxSteps: 9999 } }).quality.maxSteps).toBe(256)
    expect(nebulaParamsFromData({ quality: { maxSteps: 1 } }).quality.maxSteps).toBe(8)
  })
})
