import { afterEach, describe, expect, it, vi } from 'vitest'
import { Scene, type WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { SceneObserver } from '@/core/services/SceneObserver'
import { HeightFieldGate } from '@/core/services/HeightFieldGate'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { SyncTerrainPatchBuilder, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { config } from '@/core/framework/config'
import * as policy from '@/core/terrain/heightMapGatePolicy'

vi.mock('@/core/terrain/heightMapGatePolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/terrain/heightMapGatePolicy')>()

  return { ...actual, decideHeightMaps: vi.fn(actual.decideHeightMaps) }
})

const MOON_ID: number = 19

class TwoCopiesBuilder extends SyncTerrainPatchBuilder {
  public override get mapCopies(): number {
    return 2
  }
}

function makeGate(builder: TerrainPatchBuilder): HeightFieldGate {
  const scene = new Scene()
  const node = new DynamicNode(Actor.find(MOON_ID)!)

  node.name = Actor.find(MOON_ID)!.getAttribute('name', '')
  scene.add(node)
  const factory = { upgradePlanetToTerrain: vi.fn(() => false), downgradeTerrainToPlanet: vi.fn(() => false), resyncSurfaceMaterials: vi.fn() }
  const renderer = { domElement: { height: 1080 } } as unknown as WebGLRenderer

  return new HeightFieldGate(new SceneObserver(), scene, factory as never, renderer, builder)
}

afterEach(() => {
  heightFieldStorage.clear()
  vi.clearAllMocks()
})

describe('HeightFieldGate: множитель копий строителя', () => {
  it('передаёт в политику mapCopies строителя и бюджет в байтах', () => {
    const gate = makeGate(new TwoCopiesBuilder())

    gate.recompute()
    gate.dispose()

    const call = vi.mocked(policy.decideHeightMaps).mock.calls.at(-1)!

    expect(call[6]).toBe(2)
    expect(call[5]).toBe(config('terrain.heightMapBudgetMiB') * 1024 * 1024)
  })

  it('синхронный строитель — множитель 1', () => {
    const gate = makeGate(new SyncTerrainPatchBuilder())

    gate.recompute()
    gate.dispose()

    expect(vi.mocked(policy.decideHeightMaps).mock.calls.at(-1)![6]).toBe(1)
  })
})
