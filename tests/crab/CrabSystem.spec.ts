import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Actors, PhysicalObjects, RenderingObjects, RotationObjects } from '@storage/database'
import { Scenarios } from '@/config/scenarios'
import { three } from '@/config/three'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
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
  it('корень — барицентр; под ним ровно три актора: пульсар (12), оболочка и синхротронное свечение (7)', () => {
    const root = byName('Crab Nebula system')
    const psr = byName('PSR B0531+21')
    const shell = byName('Crab shell')
    const glow = byName('Crab synchrotron glow')
    const children = Actors.filter((a) => a.parentId === root.id)

    expect(root.categoryId).toBe(1)
    expect(psr.categoryId).toBe(12)
    expect(shell.categoryId).toBe(7)
    expect(glow.categoryId).toBe(7)
    expect(children.map((a) => a.id).sort()).toEqual([psr.id, shell.id, glow.id].sort())
    expect(RenderingObjects.filter((r) => [psr.id, shell.id, glow.id].includes(r.actorId))).toHaveLength(3)
  })

  it('свечение — гладкий эллипсоид внутри оболочки: без гребней и Вороного, малый контраст, короче лучей нет нужды', () => {
    const shell = nebulaOf('Crab shell')
    const glow = nebulaOf('Crab synchrotron glow')

    expect(glow.shape).toBe('ellipsoid')
    expect(glow.size!).toBeLessThan(shell.size!)
    expect(glow.noise?.ridged ?? 0).toBe(0)
    expect(glow.noise?.worleyStrength ?? 0).toBe(0)
    expect(glow.noise!.contrast).toBeLessThanOrEqual(1.5)
    expect(glow.noise!.octaves).toBeLessThanOrEqual(3)
  })

  it('оболочка и свечение вытянуты 3:2 вдоль полюса пульсара: axisRatios [0.75, 1, 0.75], ось формы = полюс (0.5°)', () => {
    const psr = byName('PSR B0531+21')
    const rotation = RotationObjects.find((r) => r.actorId === psr.id) as unknown as Record<string, number>
    const model = {
      rotation: { getAttribute: (k: string, f = 0): number => rotation[k] ?? f },
      physicalObject: null
    } as unknown as Actor
    const pole = new Vector3(0, 1, 0).applyQuaternion(new OrientationModel(model).getPoleQuaternion())
    const deg = Math.PI / 180

    for (const name of ['Crab shell', 'Crab synchrotron glow']) {
      const data = nebulaOf(name)
      expect(data.axisRatios, name).toEqual([0.75, 1, 0.75])
      const [x, y, z] = data.shapeRotation!
      // Поле туманности: s = toShape · p, toShape = R(e)ᵀ — ось формы в кадре прокси = R(e)·Y
      const toShape = shapeRotationMatrix(new Vector3(x * deg, y * deg, z * deg))
      const axis = new Vector3(0, 1, 0).applyMatrix3(toShape.clone().transpose())

      expect(axis.angleTo(pole), name).toBeLessThan(0.5 * deg)
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

  it('оболочка — shell 450 а.е. с запечкой на потолке 256 и маршем 96 шагов; лучи короче оболочки', () => {
    const shell = nebulaOf('Crab shell')
    const psr = renderingOf(byName('PSR B0531+21').id) as IPulsarRenderingObject

    expect(shell.shape).toBe('shell')
    expect(shell.size).toBe(450)
    expect(shell.quality?.bakeResolution).toBe(256)
    expect(shell.quality?.maxSteps).toBe(96)
    expect(shell.noise?.octaves).toBe(6)
    expect(psr.beamLengthAu!).toBeLessThan(shell.size!)
  })

  it('куб-прокси оболочки остаётся внутри far при обзоре с запасом 1.3× на отъезд в любой ориентации', () => {
    const scenario = Scenarios.find((s) => s.id === 14)!
    const cameraDistance = new Vector3(...scenario.defaultCameraPosition).length()
    for (const name of ['Crab shell', 'Crab synchrotron glow']) {
      // Прокси объёма — куб, клипится far по глубине; худший случай — камера на диагонали куба
      const cubeDiagonal = fromAstronomicalUnits(nebulaOf(name).size!) * Math.sqrt(3)
      expect(cameraDistance * 1.3 + cubeDiagonal, name).toBeLessThan(three.camera.far)
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
