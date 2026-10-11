import { ActorResource, RenderingObjects, Resources } from '@storage/database'
import { IActorResource, IRenderingObject, IResource } from '@/core/models/types'

/** Средняя полоса требует slope-карту; настройки лун Darkness индивидуальны. */
describe('Данные средней полосы детали рельефа', () => {
  const withMacro = RenderingObjects.filter(
    (row: IRenderingObject): boolean => (row.data as { macroStrength?: unknown } | undefined)?.macroStrength !== undefined
  )

  it('macroStrength — конечное число ≥ 0', () => {
    const wrong = withMacro.filter((row: IRenderingObject): boolean => {
      const value = (row.data as { macroStrength?: unknown }).macroStrength

      return typeof value !== 'number' || !Number.isFinite(value) || value < 0
    })

    expect(wrong).toEqual([])
  })

  it('у актора с macroStrength привязан ресурс типа slope', () => {
    const slopeOwners: Set<number> = new Set(
      ActorResource.filter((link: IActorResource): boolean => {
        const resource = Resources.find((r: IResource): boolean => r.id === link.resourceId)

        return resource?.resourceType === 'slope'
      }).map((link: IActorResource): number => link.actorId)
    )

    const withoutSlope = withMacro.filter((row: IRenderingObject): boolean => !slopeOwners.has(row.actorId))

    expect(withoutSlope).toEqual([])
  })

  it('формы склона настроены у 12 лун Darkness; у остальных 55 тел прежняя сила средней полосы', () => {
    const structureKeys = ['macroStreakStrength', 'macroStreakScaleKm', 'macroTerraceStrength', 'macroTerraceStepMeters', 'macroStreakChart']
    const withStructures = RenderingObjects.filter((row: IRenderingObject): boolean =>
      structureKeys.some((key: string): boolean => (row.data as Record<string, unknown> | undefined)?.[key] !== undefined)
    )
    const moonIds = [150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161]
    const iceMoonIds = [151, 153, 154, 156, 157, 158, 159]
    expect(withStructures.map((row) => row.actorId).sort((a, b) => a - b)).toEqual(moonIds)
    expect(withMacro).toHaveLength(67)
    const standard = withMacro.filter((row) => !moonIds.includes(row.actorId))
    expect(standard).toHaveLength(55)
    expect(standard.every((row) => row.data.macroStrength === 0.25)).toBe(true)
    for (const row of withStructures) {
      const icy = iceMoonIds.includes(row.actorId)
      expect(row.data.macroStrength, `actorId ${row.actorId}`).toBe(icy ? 0.18 : 0.25)
      const explicit = Object.fromEntries(structureKeys.filter((key) => row.data[key] !== undefined).map((key) => [key, row.data[key]]))
      expect(explicit, `actorId ${row.actorId}`).toEqual({ macroTerraceStrength: icy ? 0.15 : 0.35 })
    }
  })

  it('ручки геометрии средней полосы (арка B) в БД не проставлены — дефолты глобальные, живут в midbandParams.ts', () => {
    const midbandKeys = [
      'midbandStrength',
      'midbandWavelengthKm',
      'midbandFlat',
      'midbandSlopeRef',
      'midbandRidge',
      'midbandWarp',
      'midbandShade',
      'midbandWaterFadeMeters'
    ]
    const withMidband = RenderingObjects.filter((row: IRenderingObject): boolean =>
      midbandKeys.some((key: string): boolean => (row.data as Record<string, unknown> | undefined)?.[key] !== undefined)
    )
    expect(withMidband).toEqual([])
  })
})
