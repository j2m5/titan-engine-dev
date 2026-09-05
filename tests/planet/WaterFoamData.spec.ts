import { RenderingObjects } from '@storage/database'
import { IRenderingObject } from '@/core/models/types'
import { describe, expect, it } from 'vitest'
import { resolveWaterFoamParams } from '@/core/terrain/waterFoamParams'

const FOAM_KEYS = [
  'waterFoamStrength',
  'waterFoamShoreMeters',
  'waterFoamSurfMeters',
  'waterFoamWavelengthMeters',
  'waterFoamPeriodSeconds',
  'waterFoamNoiseScale',
  'waterFoamColor',
  'terrainWetBandMeters',
  'terrainWetDarken'
]

describe('Данные пены прибоя и мокрой кромки', () => {
  const dataOf = (row: IRenderingObject): Record<string, unknown> | undefined => row.data as Record<string, unknown> | undefined

  it('у тел без waterLevelMeters ручки пены/кромки не заданы', () => {
    const offenders = RenderingObjects.filter((row: IRenderingObject): boolean => {
      const data = dataOf(row)
      return data?.waterLevelMeters === undefined && FOAM_KEYS.some((key: string): boolean => data?.[key] !== undefined)
    })
    expect(offenders).toEqual([])
  })

  it('у тел с уровнем воды заданные ручки проходят резолвер; на сегодня ручки не проставлены (дефолты глобальные)', () => {
    const water = RenderingObjects.filter((row: IRenderingObject): boolean => dataOf(row)?.waterLevelMeters !== undefined)
    expect(water.length).toBe(2) // Земля, Явин IV
    for (const row of water) {
      expect(() => resolveWaterFoamParams(dataOf(row), `actorId ${row.actorId}`)).not.toThrow()
    }
    const withFoam = water.filter((row: IRenderingObject): boolean => FOAM_KEYS.some((key: string): boolean => dataOf(row)?.[key] !== undefined))
    expect(withFoam).toEqual([])
  })
})
