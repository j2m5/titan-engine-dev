import { describe, it, expect } from 'vitest'
import { frameCoverage, proximityExposure } from '@/core/renderables/WhiteDwarf/proximityExposure'
import { wdShade, WD_HDR_CEILING } from './whiteDwarfSurfaceMirror'
import { planckX } from '@/core/materials/shaders/lib/helpers'
import { WhiteDwarfShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfShaderTemplate'
import { WhiteDwarfImpostorShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostorShaderTemplate'

const FLOOR = 0.45
const START = 0.1
const END = 0.65

describe('proximityExposure — кривая адаптации', () => {
  it('ниже start единица РОВНО, а не приближённо', () => {
    // Страж неизменности дальнего вида: вся калибровка арки карлика жива
    // байт-в-байт, пока диск мал в кадре
    expect(proximityExposure(0, FLOOR, START, END)).toBe(1)
    expect(proximityExposure(START, FLOOR, START, END)).toBe(1)
    expect(proximityExposure(START * 0.5, FLOOR, START, END)).toBe(1)
  })

  it('выше end ровно floor', () => {
    expect(proximityExposure(END, FLOOR, START, END)).toBe(FLOOR)
    expect(proximityExposure(1, FLOOR, START, END)).toBe(FLOOR)
    // Камера внутри тела: coverage >> 1, пол держится
    expect(proximityExposure(100, FLOOR, START, END)).toBe(FLOOR)
  })

  it('между порогами монотонно не возрастает', () => {
    let previous = 1
    for (let i = 0; i <= 20; i++) {
      const value = proximityExposure(START + ((END - START) * i) / 20, FLOOR, START, END)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
  })

  it('непрерывна на обоих краях', () => {
    const epsilon = 1e-6
    expect(proximityExposure(START + epsilon, FLOOR, START, END)).toBeCloseTo(1, 5)
    expect(proximityExposure(END - epsilon, FLOOR, START, END)).toBeCloseTo(FLOOR, 5)
  })

  it('floor = 1 даёт тождественную единицу — точка отката', () => {
    for (const coverage of [0, START, (START + END) / 2, END, 3]) {
      expect(proximityExposure(coverage, 1, START, END)).toBe(1)
    }
  })
})

describe('frameCoverage — доля кадра', () => {
  it('точка прилёта radius*3 при fov 50 даёт около 0.77', () => {
    // Ориентир из спеки: дистанция до центра 3R, высота кадра 2*tan(25°)*3R
    const radius = 2.93
    expect(frameCoverage(radius, radius * 3, 50)).toBeCloseTo(0.7147, 3)
  })

  it('нулевая дистанция не делит на ноль', () => {
    expect(Number.isFinite(frameCoverage(1, 0, 50))).toBe(true)
  })
})

describe('wdShade — экспозиция после потолка', () => {
  it('умножает КЛИПОВАННОЕ значение, а не вход клипа', () => {
    // Sirius B прибит к потолку всей поверхностью: с exposure 0.5 обязан выйти
    // ровно в полпотолка. Умножь exposure до min — вышло бы min(вход/2, 32),
    // то есть для пробившего потолок тела те же 32, и спад не работал бы
    const clipped = wdShade(1, [1, 1, 1], planckX(25200), 1000, 0.5)
    clipped.forEach((value: number) => expect(value).toBe(WD_HDR_CEILING * 0.5))
  })

  it('exposure = 1 воспроизводит прежний выход — точка отката', () => {
    const before = wdShade(1, [1, 1, 1], planckX(11820), 40, 1)
    before.forEach((value: number) => expect(value).toBeLessThanOrEqual(WD_HDR_CEILING))
  })
})

describe('юниформ uProximityExposure', () => {
  it('есть в обоих шаблонах с нейтральной единицей', () => {
    expect(WhiteDwarfShaderTemplate.uniforms.uProximityExposure.value).toBe(1)
    expect(WhiteDwarfImpostorShaderTemplate.uniforms.uProximityExposure.value).toBe(1)
  })
})
