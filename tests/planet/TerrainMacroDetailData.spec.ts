import { ActorResource, RenderingObjects, Resources } from '@storage/database'
import { IActorResource, IRenderingObject, IResource } from '@/core/models/types'

/**
 * Страж данных средней полосы: сегодня вакуумный (ручка нигде не задана) —
 * ловит первую правку БД владельца. Полоса гейтится slope-картой, поэтому
 * ручка без привязанного slope-ресурса означала бы молча мёртвую запись.
 */
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
})
