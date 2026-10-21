import { LOD, PerspectiveCamera, Scene, Texture, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { SceneManager } from '@/core/services/SceneManager'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import { internalsOf, poolOf } from '../helpers/ringSystemInternals'

function stand() {
  const factory = new RenderableFactory({ domElement: { height: 1080 } } as never,
    { textureOf: () => null } as never, new AtmosphereRegistry(), new DepthVolumeRegistry())
  const scene = new Scene()
  const manager = new SceneManager({ update() {}, dispose() {} } as never, { showOrbitLines: false } as never, scene, factory)
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)
  return { factory, scene, manager, camera }
}

afterEach(() => vi.restoreAllMocks())

it('factory ring selects its parent LOD before preparing or deactivating detailed sectors', () => {
  vi.spyOn(resourceStorage, 'getTextureOrMake').mockReturnValue(new Texture())
  const { factory, scene, manager, camera } = stand()
  const node = factory.make(Actor.find(39)!)
  scene.add(node)
  const lod = node.children.find((child): child is LOD => child instanceof LOD)!
  let system!: AsteroidRingSystem
  node.traverse((object) => { if (object instanceof AsteroidRingSystem) system = object })
  const sectors = vi.spyOn(internalsOf(system).cascades, 'update')
  const deactivate = vi.spyOn(internalsOf(system).cascades, 'deactivateAll')
  const threshold = lod.levels[1].distance
  const ctx = { camera, delta: 0.02, epoch: 2451545, elapsed: 0 }
  try {
    camera.position.z = threshold * 2
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)
    lod.update(camera)
    manager.update(ctx)
    manager.updateView(camera)
    expect(lod.levels[0].object.visible).toBe(false)
    sectors.mockClear()
    deactivate.mockClear()

    manager.update(ctx)
    camera.position.z = threshold * 0.25 // final follow/collision correction
    manager.updateView(camera)
    expect(lod.levels[0].object.visible).toBe(true)
    expect(sectors).toHaveBeenCalledTimes(1)
    const expected = system.worldToLocal(camera.getWorldPosition(new Vector3()))
    expect(poolOf(system).geometryMaterial.uniforms.uDustCamRingPos.value.distanceTo(expected)).toBeLessThan(1e-10)

    manager.update(ctx)
    camera.position.z = threshold * 2
    manager.updateView(camera)
    expect(lod.levels[0].object.visible).toBe(false)
    expect(sectors).toHaveBeenCalledTimes(1)
    expect(deactivate).toHaveBeenCalledTimes(1)
  } finally {
    manager.dispose()
  }
})

it('belt creates its streamer and updates dust from final camera, preserving the first simulation frame', () => {
  const { scene, manager, camera } = stand()
  const data: IAsteroidBeltRenderingObject = {
    innerRadiusAu: 40, outerRadiusAu: 60, thicknessAu: 0.1,
    sizeRangeKm: [0.5, 60], spacingKm: 60, dustEnabled: true, spinPeriodHours: 1
  }
  const actor = {
    placement: null, renderingObject: { getAttribute: () => data },
    getAttribute: (_key: string, fallback: unknown) => fallback
  } as unknown as Actor
  const belt = new AsteroidBelt(actor)
  scene.add(belt)
  const ctx = { camera, delta: 0.02, epoch: 2451545.001, elapsed: 0 }
  const dust = belt.children.find((object) => object.name === 'RingDustVolume')!
  try {
    camera.position.x = fromAstronomicalUnits(100)
    manager.update(ctx)
    camera.position.x = fromAstronomicalUnits(50)
    manager.updateView(camera)
    const system = belt.children.find((object): object is AsteroidRingSystem => object instanceof AsteroidRingSystem)
    expect(system).toBeDefined()
    expect(system!.visible).toBe(true)
    expect(poolOf(system!).geometryMaterial.uniforms.uSpinTime.value).toBeGreaterThan(0)
    const dustUniforms = (dust as import('@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume').RingDustVolume).dustMaterial.uniforms
    expect(dustUniforms.uDustCamRingPos.value.x).toBeCloseTo(camera.position.x, 6)

    const sectors = vi.spyOn(internalsOf(system!).cascades, 'update')
    manager.update(ctx)
    camera.position.x = fromAstronomicalUnits(100)
    manager.updateView(camera)
    expect(system!.visible).toBe(false)
    expect(sectors).not.toHaveBeenCalled()
    expect(dustUniforms.uDustCamRingPos.value.x).toBeCloseTo(camera.position.x, 6)
  } finally {
    manager.dispose()
  }
})
