import { describe, expect, it } from 'vitest'
import { Color, Group, LOD, Mesh, Object3D, Vector3 } from 'three'
import { EclipseSystem, type EclipseBodyNode } from '@/core/eclipse/EclipseSystem'
import { resolveUmbraGlow } from '@/core/eclipse/umbraGlow'
import type { EclipseUniformData } from '@/core/eclipse/eclipseUniforms'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { SpaceScale } from '@/core/constants'
import type { Actor } from '@/core/models/Actor'

// Минимальный узел тела: модель с радиусом/именем/детьми и поверхность с материалом-шпионом
function body(id: number, radiusKm: number, pos: [number, number, number], opts: { atmosphere?: boolean; star?: boolean } = {}) {
  const calls: EclipseUniformData[] = []
  const surface = new Mesh()
  ;(surface as unknown as { material: unknown }).material = { setEclipse: (d: EclipseUniformData) => calls.push(structuredClone({ count: d.count, star: d.star.toArray(), occ0: d.occluders[0].toArray() }) as never) }
  const model = {
    getAttribute: (k: string, d?: unknown) => (k === 'id' ? id : k === 'name' ? `B${id}` : d),
    physicalObject: { getAttribute: (k: string) => (k === 'radius' ? radiusKm : undefined) },
    renderingObject: { getAttribute: () => ({}) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => opts.atmosphere ?? false }) }
  } as unknown as Actor
  const node = new Group() as unknown as EclipseBodyNode
  node.model = model
  node.renderable = surface
  node.position.set(...pos)
  node.add(surface)
  return { node, calls }
}

describe('resolveUmbraGlow', () => {
  it('дефолт 0.02, значение из данных, отказ на отрицательном', () => {
    expect(resolveUmbraGlow(undefined, 'T')).toBe(0.02)
    expect(resolveUmbraGlow({ umbraGlow: 0.1 }, 'T')).toBe(0.1)
    expect(() => resolveUmbraGlow({ umbraGlow: -1 }, 'T')).toThrow(/umbraGlow/)
  })
})

describe('EclipseSystem', () => {
  it('без звезды у тела — count 0', () => {
    const sys = new EclipseSystem(undefined, () => undefined)
    const a = body(7, 6371, [75000, 0, 0])
    const b = body(19, 1737, [74800, 0, 0])
    sys.register(a.node)
    sys.register(b.node)
    sys.update()
    expect(a.calls.at(-1)!.count).toBe(0)
  })

  it('Луна соосно — один затеняющий; центр в системе тела = центр Луны − центр Земли', () => {
    const sys = new EclipseSystem(undefined, () => 696000)
    const earth = body(7, 6371, [75000, 0, 0])
    const moon = body(19, 1737, [74800, 0, 0])
    sys.register(earth.node)
    sys.register(moon.node)
    sys.update()
    const last = earth.calls.at(-1)! as unknown as { count: number; star: number[]; occ0: number[] }
    expect(last.count).toBe(1)
    expect(last.occ0[0]).toBeCloseTo(-200, 6)
    expect(last.occ0[3]).toBeCloseTo(toThreeJSUnits(1737), 12)
    expect(last.star[0]).toBeCloseTo(-75000, 6)
  })

  it('атмосфера тела получает данные в км, мировые оси', () => {
    const registry = new AtmosphereRegistry()
    const atmObject = new Object3D()
    registry.register({ actorId: 1007, bodyActorId: 7, name: 'A', object: atmObject, config: {} as never, lut: {} as never })
    const sys = new EclipseSystem(registry, () => 696000)
    const earth = body(7, 6371, [75000, 0, 0])
    const moon = body(19, 1737, [74800, 0, 0])
    sys.register(earth.node)
    sys.register(moon.node)
    sys.update()
    const e = registry.get(1007)!.eclipse!
    expect(e.count).toBe(1)
    expect(e.occluders[0].x).toBeCloseTo(-200 / SpaceScale, 3)
    expect(e.starRadius).toBeCloseTo(696000, 6)
  })

  it('точка-импостор тела в тени получает затемнение', () => {
    const sys = new EclipseSystem(undefined, () => 696000)
    const moon = body(19, 1737, [75200, 0, 0])
    const earth = body(7, 6371, [75000, 0, 0])
    const lod = new LOD()
    const fake = new Object3D() as Object3D & { eclipseLight: Color }
    fake.eclipseLight = new Color(1, 1, 1)
    ;(fake as unknown as { isFakePlanet: boolean }).isFakePlanet = true
    lod.addLevel(new Object3D())
    lod.addLevel(fake, 100)
    moon.node.add(lod)
    sys.register(moon.node)
    sys.register(earth.node)
    sys.update()
    expect(fake.eclipseLight.r).toBeLessThan(0.5)
  })

  it('clear снимает тела', () => {
    const sys = new EclipseSystem(undefined, () => 696000)
    const a = body(7, 6371, [75000, 0, 0])
    sys.register(a.node)
    sys.clear()
    sys.update()
    expect(a.calls.length).toBe(0)
  })

  it('позиция узла тела не мутируется системой', () => {
    const sys = new EclipseSystem(undefined, () => 696000)
    const a = body(7, 6371, [75000, 0, 0])
    sys.register(a.node)
    sys.update()
    expect(a.node.position.toArray()).toEqual(new Vector3(75000, 0, 0).toArray())
  })
})
