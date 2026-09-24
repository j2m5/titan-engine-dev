import { describe, it, expect, vi } from 'vitest'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { IObject3DVisitor } from '@/core/services/visitors/IObject3DVisitor'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { Quaternion, Vector3 } from 'three'
import { degToRad, radToDeg } from 'three/src/math/MathUtils'
import { ASTRO_TO_THREE } from '@/core/libs/frames'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { AU, SpaceScale } from '@/core/constants'

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

  it('наклон и узел означают то же, что у орбит: полюс = ASTRO_TO_THREE · Rz(узел)·Rx(наклон) · ẑ', () => {
    const node = new PlacedNode(actorStub(null, 'Belt', { ascendingNode: 75, inclination: 4 }))
    const qNode = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degToRad(75))
    const qInc = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), degToRad(4))
    const expectedUp = new Vector3(0, 0, 1).applyQuaternion(qInc).applyQuaternion(qNode).applyQuaternion(ASTRO_TO_THREE)

    const up = new Vector3(0, 1, 0).applyQuaternion(node.quaternion)
    expect(up.distanceTo(expectedUp)).toBeCloseTo(0, 9)
  })

  it('поворот не сдвигает начало координат: точка (0,0,0) остаётся в нуле', () => {
    const node = new PlacedNode(actorStub(null, 'Belt', { ascendingNode: 75, inclination: 4 }))
    node.updateMatrixWorld(true)

    expect(node.localToWorld(new Vector3()).length()).toBe(0)
  })
})

/** Планета на круговой орбите 18 а.е. с периодом из данных: кеплеровой модели массы не нужны */
const planetStub = (): Actor =>
  ({
    orbit: {
      getAttribute: (key: string, fallback = 0): number =>
        ({ semiMajorAxis: 18, eccentricity: 0, inclination: 0, argOfPeriapsis: 0, ascendingNode: 0, meanAnomalyAtEpoch: 0, epoch: 2451545, period: 11294 })[
          key
        ] ?? fallback
    },
    physicalObject: { getAttribute: (): number => 1.9e27 },
    parent: { physicalObject: { getAttribute: (): number => 1.213e31 } },
    getAttribute: (key: string, fallback: unknown = ''): unknown => (key === 'name' ? 'Planet' : fallback)
  }) as unknown as Actor

const lagrangeStub = (lagrange: number, parent: Actor | null = planetStub()): Actor => {
  const actor = actorStub(null, 'L cloud')
  ;(actor as unknown as { placement: unknown }).placement = {
    getAttribute: (key: string, fallback = 0): number => (key === 'lagrange' ? lagrange : fallback)
  }
  ;(actor as unknown as { parent: Actor | null }).parent = parent
  return actor
}

const ctxAt = (epoch: number) => ({ epoch, delta: 0.016, elapsed: 0 }) as never

describe('PlacedNode — точка Лагранжа родителя', () => {
  it.each([
    [4, 1],
    [5, -1]
  ])('lagrange %i: узел на орбите планеты, на 60° %s по движению, на расстоянии радиуса орбиты от неё', (point, sign) => {
    const parent = planetStub()
    const node = new PlacedNode(lagrangeStub(point, parent))
    const orbit = new KeplerianModel(parent)

    for (const epoch of [2451545, 2451545 + 11294 * 0.37, 2451545 + 11294 * 0.8]) {
      node.updateObject(ctxAt(epoch))
      const { position: p, velocity: v } = orbit.getStateByEpoch(epoch)
      // Смещение узла — в кадре родителя, единицы сцены → а.е.
      const offset = node.position.clone().divideScalar(AU * SpaceScale)
      const point3 = p.clone().add(offset)

      expect(offset.length()).toBeCloseTo(p.length(), 6)
      expect(point3.length()).toBeCloseTo(p.length(), 6)
      expect(Math.sign(point3.dot(v.clone().normalize()))).toBe(sign)
      expect(radToDeg(p.angleTo(point3))).toBeCloseTo(60, 6)
    }
  })

  it('без lagrange updateObject ничего не двигает — позиция из placement', () => {
    const node = new PlacedNode(actorStub({ x: 1, y: 0, z: -2 }))
    const before = node.position.clone()

    node.updateObject(ctxAt(2451545 + 100))

    expect(node.position.equals(before)).toBe(true)
  })

  it('lagrange без орбиты у родителя — узел стоит в нуле и не падает', () => {
    const node = new PlacedNode(lagrangeStub(4, null))

    expect(() => node.updateObject(ctxAt(2451545))).not.toThrow()
    expect(node.position.length()).toBe(0)
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
