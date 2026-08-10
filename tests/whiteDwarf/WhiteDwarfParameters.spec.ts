import { describe, it, expect } from 'vitest'
import { Actor } from '@/core/models/Actor'
import {
  whiteDwarfParameters,
  WHITE_DWARF_DEFAULT_TEMPERATURE_K,
  WHITE_DWARF_DISPLAY_SCALE,
  type WhiteDwarfParameters
} from '@/core/renderables/WhiteDwarf/WhiteDwarfParameters'
import { IWhiteDwarfRenderingObject } from '@/core/models/types'

const G29_38_K: number = 11820

function stubActor(data: IWhiteDwarfRenderingObject = {}, temperature: number = G29_38_K): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => (key === 'categoryId' ? 9 : def),
    rotation: null,
    renderingObject: { getAttribute: () => data },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 8840 : key === 'temperature' ? temperature : def
    }
  } as unknown as Actor
}

describe('параметры белого карлика', () => {
  it('ручка ровно одна: всё остальное выводится из температуры', () => {
    // Цвет, яркость и лимбовое потемнение — функции одной величины. Появление
    // здесь второй ручки означает, что их снова можно развести между собой и
    // получить тело, у которого цвет не соответствует яркости
    const params: WhiteDwarfParameters = whiteDwarfParameters(stubActor())

    expect(Object.keys(params).sort()).toEqual(['exposureBias', 'temperature'])
  })

  it('пустые данные дают нейтральную экспозицию', () => {
    const params: WhiteDwarfParameters = whiteDwarfParameters(stubActor())

    expect(params.temperature).toBe(G29_38_K)
    expect(params.exposureBias).toBe(1)
  })

  it('без температуры в физическом объекте берётся дефолт типа', () => {
    const actor = {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'categoryId' ? 9 : def),
      rotation: null,
      renderingObject: { getAttribute: () => ({}) },
      physicalObject: {
        getAttribute: (key: string, def?: unknown): unknown => (key === 'radius' ? 8840 : def)
      }
    } as unknown as Actor

    expect(whiteDwarfParameters(actor).temperature).toBe(WHITE_DWARF_DEFAULT_TEMPERATURE_K)
  })

  it('ноль переживает чтение — это точка отката, а не «значение не задано»', () => {
    // `??` вместо `||`: погашенное тело обязано доезжать до материала нулём
    expect(whiteDwarfParameters(stubActor({ exposureBias: 0 })).exposureBias).toBe(0)
  })

  it('экспозиция клампится снизу', () => {
    // Отрицательный множитель дал бы отрицательную светимость, которую потолок
    // HDR не ловит — он ограничивает только сверху
    expect(whiteDwarfParameters(stubActor({ exposureBias: -2 })).exposureBias).toBe(0)
  })

  it('единица экспозиции означает откалиброванный уровень, а не честную физику', () => {
    // Разведение этих двух понятий несущее: `exposureBias: 1` в данных читается
    // как «нейтрально», и если бы оно означало честные 214 у Sirius B, кадр
    // заливало бы блумом. Калибровка живёт отдельной константой
    expect(WHITE_DWARF_DISPLAY_SCALE).toBeLessThan(1)
    expect(whiteDwarfParameters(stubActor()).exposureBias).toBe(1)
  })
})
