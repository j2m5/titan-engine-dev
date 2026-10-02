import { describe, expect, it } from 'vitest'
import { Actor } from '@/core/models/Actor'
import { DEFAULT_OPPOSITION_SURGE, regolithParamsOf, resolveRegolithParams } from '@/core/terrain/regolithParams'

describe('resolveRegolithParams', () => {
  it('без данных: реголит по отсутствию атмосферы, всплеск 0.3', () => {
    expect(resolveRegolithParams(undefined, false, 'T')).toEqual({ regolithMix: 1, oppositionSurge: DEFAULT_OPPOSITION_SURGE })
    expect(resolveRegolithParams(undefined, true, 'T')).toEqual({ regolithMix: 0, oppositionSurge: 0.3 })
  })

  it('данные перекрывают дефолт в обе стороны', () => {
    expect(resolveRegolithParams({ regolithMix: 0.4, oppositionSurge: 0.5 }, false, 'T')).toEqual({ regolithMix: 0.4, oppositionSurge: 0.5 })
    expect(resolveRegolithParams({ regolithMix: 0 }, false, 'T').regolithMix).toBe(0)
    expect(resolveRegolithParams({ regolithMix: 0.7 }, true, 'T').regolithMix).toBe(0.7)
  })

  it('громкие отказы с контекстом', () => {
    expect(() => resolveRegolithParams({ regolithMix: 1.2 }, false, 'Луна')).toThrow(/Луна.*regolithMix/)
    expect(() => resolveRegolithParams({ regolithMix: -0.1 }, false, 'Луна')).toThrow(/regolithMix/)
    expect(() => resolveRegolithParams({ oppositionSurge: -1 }, false, 'Луна')).toThrow(/oppositionSurge/)
    expect(() => resolveRegolithParams({ regolithMix: 'x' }, false, 'Луна')).toThrow(/regolithMix/)
  })
})

describe('regolithParamsOf на данных БД', () => {
  it('Луна (без атмосферы) — реголит, Земля (с атмосферой) — ламберт', () => {
    expect(regolithParamsOf(Actor.find(19)!).regolithMix).toBe(1)
    expect(regolithParamsOf(Actor.find(7)!).regolithMix).toBe(0)
  })
})
