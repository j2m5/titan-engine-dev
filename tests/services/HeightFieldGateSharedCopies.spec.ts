import { afterEach, expect, it, vi } from 'vitest'
import { Scene, Vector3, type WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { SceneObserver } from '@/core/services/SceneObserver'
import { HeightFieldGate } from '@/core/services/HeightFieldGate'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import type { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { TerrainHeightField, terrainHeightFieldFor } from '@/core/terrain/TerrainHeightField'
import { midbandParamsOf } from '@/core/terrain/midbandParams'
import { heightPathOf } from '@/core/terrain/heightPath'
import { SyncTerrainPatchBuilder, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { WorkerTerrainPatchBuilder, type WorkerLike } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import type { ToWorkerMessage, FromWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'
import { terrain } from '@/config/terrain'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

/** Real message transfer and worker handler, without a separate OS process. */
class RecordingWorker implements WorkerLike {
  onmessage: ((ev: { data: FromWorkerMessage }) => void) | null = null
  readonly state = createWorkerState()
  registrations = 0
  transferredBytes = 0
  postMessage(message: ToWorkerMessage, transfer: Transferable[]): void {
    if (message.type === 'registerField') {
      this.registrations++
      this.transferredBytes += transfer.reduce<number>((sum, buffer) => sum + (buffer as ArrayBuffer).byteLength, 0)
    }
    handleWorkerMessage(this.state, structuredClone(message, { transfer }))
  }
  terminate(): void { this.state.fields.clear() }
  residentBytes(): number {
    const buffers = new Set<ArrayBufferLike>()
    for (const field of this.state.fields.values()) {
      buffers.add(field.heightMap.data.buffer)
      const aux = field.exportAux()
      for (const value of [aux.clearanceGrid, aux.levelErrorMeters, aux.nodeMaxHeightMetersPyramid, aux.nodeErrorMetersPyramid]) {
        if (value) buffers.add(value.buffer)
      }
    }
    return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0)
  }
}

afterEach(() => { heightFieldStorage.clear(); vi.restoreAllMocks() })

it.each([
  { variation: 'radius', sync: false, sharedFields: 3 },
  { variation: 'same', sync: false, sharedFields: 1 },
  { variation: 'midbandStrength', sync: false, sharedFields: 3 },
  { variation: 'midbandShade', sync: false, sharedFields: 1 },
  { variation: 'radius', sync: true, sharedFields: 3 }
])('budgets actual shared-map copies for $variation (sync=$sync) and releases them', ({ variation, sync, sharedFields }) => {
  const mapBase: HeightMapData = {
    width: 128, height: 64, minMeters: 0, maxMeters: 1000, data: new Uint16Array(128 * 64).fill(32768)
  }
  const mapA = { ...mapBase, aux: new TerrainHeightField(mapBase, 1000).exportAux() }
  const mapB = structuredClone(mapA)
  const sharedActor = Actor.find(19)!
  const bodies = [19, 22, 23].map((id, index) => {
    const actor = Actor.find(id)!.clone()
    const physical = sharedActor.physicalObject!.clone()
    if (variation === 'radius') physical.setAttribute('radius', physical.getAttribute('radius')! * (index + 1))
    const rendering = sharedActor.renderingObject!.clone()
    rendering.setAttribute('data', {
      ...rendering.getAttribute('data'),
      ...(variation.startsWith('midband') ? { [variation]: (index + 1) / 4 } : {})
    })
    Object.defineProperties(actor, {
      resources: { get: () => sharedActor.resources },
      physicalObject: { get: () => physical },
      renderingObject: { get: () => rendering }
    })
    return actor
  })
  bodies.push(Actor.find(20)!)
  const pathA = heightPathOf(bodies[0])!, pathB = heightPathOf(bodies[3])!
  expect(pathA).not.toBe(pathB)
  heightFieldStorage['maps'].set(pathA, mapA)
  heightFieldStorage['maps'].set(pathB, mapB)
  const sizeA = heightFieldStorage.bytesOf(pathA)!, sizeB = heightFieldStorage.bytesOf(pathB)!
  const budget = 2 * sizeA + 2 * sizeB
  const oldBudget = terrain.terrain.heightMapBudgetMiB
  terrain.terrain.heightMapBudgetMiB = budget / 1024 / 1024
  const scene = new Scene(), observer = new SceneObserver(), worker = new RecordingWorker()
  const builder: TerrainPatchBuilder = sync ? new SyncTerrainPatchBuilder() : new WorkerTerrainPatchBuilder(() => worker)
  const acquired = new Map<DynamicNode, TerrainHeightField>()
  const factory = {
    upgradePlanetToTerrain(node: DynamicNode) {
      if (!acquired.has(node)) {
        const field = terrainHeightFieldFor(heightFieldStorage.get(heightPathOf(node.model)!)!,
          node.model.physicalObject!.getAttribute('radius')!, midbandParamsOf(node.model))
        builder.acquire(field)
        acquired.set(node, field)
      }
      return false
    },
    downgradeTerrainToPlanet(node: DynamicNode) {
      const field = acquired.get(node)
      if (field) { builder.release(field); acquired.delete(node) }
      return false
    },
    resyncSurfaceMaterials() {}
  }
  const gate = new HeightFieldGate(observer, scene, factory as unknown as RenderableFactory,
    { domElement: { height: 1080 } } as unknown as WebGLRenderer, builder)
  try {
    for (const [index, actor] of bodies.entries()) {
      scene.add(new DynamicNode(actor))
      observer.add({ actorId: actor.getAttribute('id')!, name: actor.getAttribute('name', ''),
        distance: index === 3 ? 10 : 1, position: new Vector3() })
    }
    gate.recompute()
    const keepsBoth = sync || sharedFields === 1
    expect(heightFieldStorage.heldPaths()).toEqual(keepsBoth ? [pathA, pathB] : [pathA])
    expect(worker.registrations).toBe(sync ? 0 : sharedFields + (keepsBoth ? 1 : 0))
    expect(sizeA + (keepsBoth ? sizeB : 0) + worker.residentBytes()).toBeLessThanOrEqual(budget)
    expect(worker.transferredBytes).toBe(worker.residentBytes())
    expect(mapA.data.byteLength).toBe(128 * 64 * 2)

    for (const record of observer.data.values()) record.distance = 1e20
    gate.recompute()
    expect(heightFieldStorage.heldPaths()).toEqual([])
    expect(acquired.size).toBe(0)
    expect(worker.state.fields.size).toBe(0)
    expect(worker.residentBytes()).toBe(0)
  } finally {
    terrain.terrain.heightMapBudgetMiB = oldBudget
    gate.dispose()
    for (const field of acquired.values()) builder.release(field)
    builder.dispose()
  }
})
