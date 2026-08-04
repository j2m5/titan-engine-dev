import { describe, it, expect, vi } from 'vitest'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'

/**
 * Минимальный стаб актора: PlacedNode читает только name и placement.
 * Тот же приём, что в tests/KeplerianModel.spec.ts.
 */
function actorStub(placement: { x: number; y: number; z: number } | null, name = 'Test Nebula'): Actor {
  return {
    placement:
      placement === null
        ? null
        : {
            getAttribute: (key: string, fallback = 0): number =>
              (placement as unknown as Record<string, number>)[key] ?? fallback
          },
    getAttribute: (key: string, fallback: unknown = ''): unknown => (key === 'name' ? name : fallback)
  } as unknown as Actor
}

function visitorSpy(): IObject3DVisitor & {
  visitNode: ReturnType<typeof vi.fn>
  visitComponent: ReturnType<typeof vi.fn>
} {
  return {
    visitRoot: vi.fn(),
    visitNode: vi.fn(),
    visitRootNode: vi.fn(),
    visitComponent: vi.fn()
  } as unknown as IObject3DVisitor & {
    visitNode: ReturnType<typeof vi.fn>
    visitComponent: ReturnType<typeof vi.fn>
  }
}

describe('PlacedNode — позиция', () => {
  it('без строки placement стоит в начале координат родителя', () => {
    const node = new PlacedNode(actorStub(null))

    expect(node.position.toArray()).toEqual([0, 0, 0])
  })

  it('координаты placement читаются как а.е. и переводятся в Three-юниты', () => {
    const node = new PlacedNode(actorStub({ x: 1, y: 0, z: -2 }))

    expect(node.position.x).toBeCloseTo(fromAstronomicalUnits(1), 6)
    expect(node.position.y).toBe(0)
    expect(node.position.z).toBeCloseTo(fromAstronomicalUnits(-2), 6)
  })

  it('имя берётся у актора', () => {
    expect(new PlacedNode(actorStub(null, 'Horuset Nebula')).name).toBe('Horuset Nebula')
  })
})

describe('PlacedNode — обход визитором', () => {
  it('идёт как самостоятельный узел, а не как компонент родителя', () => {
    // Несущее отличие от StaticNode: visitComponent положил бы узел
    // в equatorialFrame родителя — это семантика колец и атмосфер.
    const visitor = visitorSpy()

    new PlacedNode(actorStub(null)).accept(visitor)

    expect(visitor.visitNode).toHaveBeenCalledTimes(1)
    expect(visitor.visitComponent).not.toHaveBeenCalled()
  })
})
