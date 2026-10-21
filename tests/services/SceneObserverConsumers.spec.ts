import { afterEach, expect, it, vi } from 'vitest'
import { Mesh, Scene, Texture, Vector3, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { SceneObserver } from '@/core/services/SceneObserver'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { HeightFieldGate } from '@/core/services/HeightFieldGate'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import type { MapCandidate } from '@/core/streaming/types'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { DistanceBasedCSS2DObject } from '@/core/renderables/utils/DistanceBasedCSS2DObject'
import { SyncTerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { heightPathOf } from '@/core/terrain/heightPath'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadResult } from '@/core/textures/types'
import type { UpdateContext } from '@/core/UpdateContext'
import { makeAstroControlsStub } from './sceneObserverStubs'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn()
  heightFieldStorage.clear()
  resourceStorage.deleteAllTextures()
  vi.restoreAllMocks()
})

function world(names = ['Twin', 'Twin']) {
  const scene = new Scene()
  const actors = [Actor.find(19)!.clone(), Actor.find(23)!.clone()]
  const materials = actors.map(() => ({ updateMaterial: vi.fn(), resetMaterial: vi.fn() }))
  const nodes = actors.map((actor, index) => {
    actor.setAttribute('name', names[index])
    const node = new DynamicNode(actor)
    const surface = new Mesh()
    surface.model = actor
    surface.userData.type = 'planet'
    surface.material = materials[index] as never
    node.renderable = surface as never
    node.add(surface)
    node.position.x = index + 1
    scene.add(node)
    return node
  })
  const observer = new SceneObserver()
  const controls = makeAstroControlsStub()
  observer.observable = controls
  observer.scene = scene
  const update = (): void => controls.dispatch(new Vector3())
  update()
  cleanup.push(() => observer.dispose())
  return { scene, actors, nodes, materials, observer, controls, update }
}

function texture(): Texture {
  const result = new Texture()
  result.image = { width: 4, height: 2 }
  return result
}

function resources(w: ReturnType<typeof world>, load: TextureProvider['load']) {
  const observer = new ResourceObserver(w.observer, { load } as TextureProvider,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() }, { dispatch: vi.fn() },
    w.scene, new TextureBudget(1024 ** 3))
  for (const actor of w.actors) observer.map.set(actor.getAttribute('id')!, actor)
  cleanup.push(() => { observer.scenario = null })
  return {
    observer,
    run: () => (observer as unknown as { closestChange(): Promise<void> }).closestChange(),
    load: (candidate: MapCandidate) => (observer as unknown as { loadPath(c: MapCandidate): Promise<void> }).loadPath(candidate)
  }
}

function candidate(actor: Actor): MapCandidate {
  return { actorId: actor.getAttribute('id')!, name: actor.getAttribute('name')!,
    path: actor.resources.where('resourceType', 'diffuse').first()!.getAttribute('path')!, typeRank: 0, actorPriority: 1 }
}

it('streams resources belonging to both observed namesakes and updates both materials', async () => {
  const w = world()
  const load = vi.fn(async (): Promise<LoadResult> => ({ ok: true, texture: texture() }))
  const r = resources(w, load)
  await r.run()
  const paths = load.mock.calls.map((args) => (args as unknown as [{ name: string }])[0].name)
  expect(paths).toContain(candidate(w.actors[0]).path)
  expect(paths).toContain(candidate(w.actors[1]).path)
  for (const material of w.materials) expect(material.updateMaterial).toHaveBeenCalled()
})

it('updates and evicts the material identified by actor ID when names collide', async () => {
  const w = world()
  const r = resources(w, async () => ({ ok: true, texture: texture() }))
  const target = candidate(w.actors[1])
  await r.load(target)
  expect(w.materials[1].updateMaterial).toHaveBeenCalledTimes(1)
  expect(w.materials[0].updateMaterial).not.toHaveBeenCalled()
  r.observer.evictPath(target)
  expect(w.materials[1].resetMaterial).toHaveBeenCalledTimes(1)
  expect(w.materials[0].resetMaterial).not.toHaveBeenCalled()
})

it('keeps material ownership when an actor is renamed during texture loading', async () => {
  const w = world(['First', 'Second'])
  let finish!: (result: LoadResult) => void
  const r = resources(w, () => new Promise((resolve) => { finish = resolve }))
  const pending = r.load(candidate(w.actors[1]))
  w.actors[1].setAttribute('name', 'Renamed')
  finish({ ok: true, texture: texture() })
  await pending
  expect(w.materials[1].updateMaterial).toHaveBeenCalledTimes(1)
  expect(w.materials[0].updateMaterial).not.toHaveBeenCalled()
})

it('requests each namesake height map using the corresponding DynamicNode model', () => {
  const w = world()
  const request = vi.spyOn(heightFieldStorage, 'request').mockImplementation(() => {})
  const factory = { upgradePlanetToTerrain: vi.fn(() => false), downgradeTerrainToPlanet: vi.fn(() => false), resyncSurfaceMaterials: vi.fn() }
  const gate = new HeightFieldGate(w.observer, w.scene, factory as never,
    { domElement: { height: 1080 } } as WebGLRenderer, new SyncTerrainPatchBuilder())
  cleanup.push(() => gate.dispose())
  gate.recompute()
  expect(request).toHaveBeenCalledWith(heightPathOf(w.actors[0]))
  expect(request).toHaveBeenCalledWith(heightPathOf(w.actors[1]))
})

class Label extends DistanceBasedCSS2DObject {
  constructor(actor: Actor, observer: SceneObserver) { super(actor, observer) }
}

it('fades namesake labels using their own distances', () => {
  const w = world()
  w.nodes[0].position.x = toThreeJSUnits(w.actors[0].physicalObject!.getAttribute('radius')!) * 2
  w.nodes[1].position.x = toThreeJSUnits(w.actors[1].physicalObject!.getAttribute('radius')!) * 20
  w.update()
  const labels = w.actors.map((actor) => new Label(actor, w.observer))
  for (const label of labels) label.updateObject({} as UpdateContext)
  expect(labels[0].element.style.opacity).toBe('0')
  expect(labels[1].element.style.opacity).toBe('1')
})
