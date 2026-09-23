import { describe, it, expect, vi } from 'vitest'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { Quaternion, Vector3 } from 'three'
import { radToDeg } from 'three/src/math/MathUtils'

/**
 * Минимальный стаб актора: PlacedNode читает только name и placement.
 * Тот же приём, что в tests/KeplerianModel.spec.ts.
 */
function actorStub(
  placement: { x: number; y: number; z: number } | null,
  name = 'Test Nebula',
  rotation: { ascendingNode: number; inclination: number } | null = null
): Actor {
  const rowOf = (row: Record<string, number> | null) =>
    row === null ? null : { getAttribute: (key: string, fallback = 0): number => row[key] ?? fallback }

  return {
    placement: rowOf(placement as unknown as Record<string, number> | null),
    rotation: rowOf(rotation as unknown as Record<string, number> | null),
    physicalObject: null,
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

describe('PlacedNode — ориентация', () => {
  it('без строки rotation узел не повёрнут', () => {
    expect(new PlacedNode(actorStub(null)).quaternion.equals(new Quaternion())).toBe(true)
  })

  it('со строкой rotation узел наклонён полюсным кватернионом (узел + наклон, без суточного вращения)', () => {
    const actor = actorStub(null, 'Belt', { ascendingNode: 75, inclination: 4 })
    const node = new PlacedNode(actor)
    const expected = new OrientationModel(actor).getPoleQuaternion()

    expect(node.quaternion.angleTo(expected)).toBeCloseTo(0, 9)
    // Локальная ось Y (плоскость XZ узла) отклонилась от мировой ровно на наклон
    const up = new Vector3(0, 1, 0).applyQuaternion(node.quaternion)
    expect(radToDeg(up.angleTo(new Vector3(0, 1, 0)))).toBeCloseTo(4, 6)
  })

  it('поворот не сдвигает начало координат: точка (0,0,0) остаётся в нуле', () => {
    const node = new PlacedNode(actorStub(null, 'Belt', { ascendingNode: 75, inclination: 4 }))
    node.updateMatrixWorld(true)

    expect(node.localToWorld(new Vector3()).length()).toBe(0)
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
