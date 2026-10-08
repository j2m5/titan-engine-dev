import { Group, PerspectiveCamera, Scene } from 'three'
import { Actor } from '@/core/models/Actor'
import { SimulationClock } from '@/core/time/SimulationClock'
import { BodyInfoService } from '@/core/bodyInfo/BodyInfoService'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const EARTH_RADIUS_KM = 6360

/** Узел сцены, как DynamicNode/StaticNode: несёт model */
function nodeFor(actor: Actor): Group {
  return Object.assign(new Group(), { model: actor })
}

function stand() {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const earth = Actor.find(7)!
  const sun = Actor.find(4)!
  const earthNode = nodeFor(earth)
  const sunNode = nodeFor(sun)

  scene.add(sunNode, earthNode)
  earthNode.position.set(toThreeJSUnits(1e6 + EARTH_RADIUS_KM), 0, 0)
  sunNode.position.set(0, toThreeJSUnits(2e6), 0)
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)

  const service = new BodyInfoService(scene, camera, new SimulationClock(2461222.5))

  return { scene, camera, earth, sun, earthNode, service }
}

describe('BodyInfoService.measure', () => {
  it('расстояние от камеры до поверхности, до светила и скорость относительно главного тела', () => {
    const { service, earth } = stand()
    const live = service.measure(earth)!

    expect(live.distanceKm).toBeCloseTo(1e6, 0)
    expect(live.starDistanceKm).toBeCloseTo(Math.hypot(1e6 + EARTH_RADIUS_KM, 2e6), 0)
    expect(live.orbitalSpeedKms).toBeGreaterThan(29)
    expect(live.orbitalSpeedKms).toBeLessThan(30.5)
  })

  it('камера внутри радиуса тела — расстояние 0, не отрицательное', () => {
    const { service, earth, camera, earthNode } = stand()

    camera.position.copy(earthNode.position)
    camera.updateMatrixWorld(true)

    expect(service.measure(earth)!.distanceKm).toBe(0)
  })

  it('у самого светила расстояния до звезды и главного тела нет', () => {
    const { service, sun } = stand()
    const live = service.measure(sun)!

    expect(live.starDistanceKm).toBeNull()
    expect(live.orbitalSpeedKms).toBeNull()
  })

  it('тела нет в сцене — null', () => {
    const { service } = stand()

    expect(service.measure(Actor.find(8)!)).toBeNull()
  })

  it('узел отцеплен после смены сценария — null, кэш не держит мёртвый узел', () => {
    const { service, earth, scene, earthNode } = stand()

    expect(service.measure(earth)).not.toBeNull()
    scene.remove(earthNode)

    expect(service.measure(earth)).toBeNull()
  })
})
