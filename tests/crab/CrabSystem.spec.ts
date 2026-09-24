import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Actors, PhysicalObjects, RenderingObjects, RotationObjects } from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import { Actor } from '@/core/models/Actor'
import { shapeRotationMatrix } from '@/core/renderables/Nebula/fields/NebulaField'
import { OrientationModel } from '@/core/libs/OrientationModel'
import type { NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import type { IPulsarRenderingObject } from '@/core/models/types'

const byName = (name: string) => {
  const a = Actors.find((x) => x.name === name)
  expect(a, `актор «${name}» не найден`).toBeDefined()
  return a!
}
const renderingOf = (id: number) => RenderingObjects.find((r) => r.actorId === id)!.data
const nebulaOf = (name: string) => renderingOf(byName(name).id) as unknown as NebulaRenderingData

describe('сцена Краб: пульсар и остаток', () => {
  it('корень — барицентр; пульсар категории 12 под ним; три туманности под корнем', () => {
    const root = byName('Crab Nebula system')
    const psr = byName('PSR B0531+21')

    expect(root.categoryId).toBe(1)
    expect(psr.categoryId).toBe(12)
    expect(psr.parentId).toBe(root.id)
    for (const n of ['Crab shell', 'Crab wind torus', 'Crab jets']) {
      expect(byName(n).categoryId).toBe(7)
      expect(byName(n).parentId).toBe(root.id)
    }
  })

  it('физика пульсара: 10 км, 1e6 К, 1.4 M☉; строка вращения есть', () => {
    const psr = byName('PSR B0531+21')
    const phys = PhysicalObjects.find((p) => p.actorId === psr.id)!

    expect(phys.radius).toBe(10)
    expect(phys.temperature).toBe(1e6)
    expect(phys.mass).toBeCloseTo(2.8e30, -26)
    expect(RotationObjects.find((r) => r.actorId === psr.id)).toBeDefined()
  })

  it('данные пульсара: все восемь ручек заданы, лучи включены, период — секунды', () => {
    const data = renderingOf(byName('PSR B0531+21').id) as IPulsarRenderingObject

    expect(Object.keys(data)).toEqual([
      'exposureBias',
      'beamPeriodSeconds',
      'beamTiltDeg',
      'beamHalfAngleDeg',
      'beamLengthAu',
      'beamColor',
      'beamIntensity',
      'beamPhaseDeg'
    ])
    expect(data.beamIntensity).toBeGreaterThan(0)
    expect(data.beamPeriodSeconds).toBeGreaterThanOrEqual(1)
  })

  it('оболочка — shell 700 а.е., вмещает тор (180) и джеты (350); лучи короче оболочки', () => {
    const shell = nebulaOf('Crab shell')
    const torus = nebulaOf('Crab wind torus')
    const jets = nebulaOf('Crab jets')
    const psr = renderingOf(byName('PSR B0531+21').id) as IPulsarRenderingObject

    expect(shell.shape).toBe('shell')
    expect(shell.size).toBe(700)
    expect(torus.shape).toBe('torus')
    expect(jets.shape).toBe('ellipsoid')
    expect(torus.size!).toBeLessThan(shell.size! * (1 - shell.shapeThickness!))
    expect(jets.size!).toBeLessThan(shell.size! * (1 - shell.shapeThickness!))
    expect(psr.beamLengthAu!).toBeLessThan(shell.size!)
  })

  it('ось тора и джетов совпадает с полюсом пульсара (допуск 0.5°)', () => {
    const psr = byName('PSR B0531+21')
    const rotation = RotationObjects.find((r) => r.actorId === psr.id) as unknown as Record<string, number>
    const model = {
      rotation: { getAttribute: (k: string, f = 0): number => rotation[k] ?? f },
      physicalObject: null
    } as unknown as Actor
    const pole = new Vector3(0, 1, 0).applyQuaternion(new OrientationModel(model).getPoleQuaternion())
    const deg = Math.PI / 180

    for (const name of ['Crab wind torus', 'Crab jets']) {
      const [x, y, z] = nebulaOf(name).shapeRotation!
      // Поле туманности: s = toShape · p, toShape = R(e)ᵀ — ось формы в кадре прокси = R(e)·Y
      const toShape = shapeRotationMatrix(new Vector3(x * deg, y * deg, z * deg))
      const axis = new Vector3(0, 1, 0).applyMatrix3(toShape.clone().transpose())

      expect(axis.angleTo(pole), name).toBeLessThan(0.5 * deg)
    }
  })

  it('сценарий 14: корень — система Краба, светил нет, скайбокс общий', () => {
    const scenario = Scenarios.find((s) => s.rootId === byName('Crab Nebula system').id)

    expect(scenario).toBeDefined()
    expect(scenario!.id).toBe(14)
    expect(scenario!.lightSources).toEqual([])
    expect(scenario!.skybox).toEqual([1, 2, 3, 4, 5, 6])
  })
})
