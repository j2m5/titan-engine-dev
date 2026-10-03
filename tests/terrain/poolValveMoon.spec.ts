import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Mesh, PerspectiveCamera, Texture, Vector3, type WebGLRenderer } from 'three'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import {
  SyncTerrainPatchBuilder,
  type PatchBuildJob,
  type PatchBuildResult,
  type TerrainPatchBuilder
} from '@/core/terrain/terrainPatchBuilder'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'

const MOON_HEIGHT_PATH = 'storage/images/textures/planets/moon/moon_height.raw'
const RADIUS_KM = 1737.4

/** Очередь как у воркера: постройки приходят пачками по flush(n) между кадрами. */
class QueuedBuilder implements TerrainPatchBuilder {
  public readonly offThread = true
  public readonly mapCopies = 2
  public built = 0
  private readonly queue: Array<[PatchBuildJob, (result: PatchBuildResult) => void, (error: unknown) => void]> = []
  private readonly sync = new SyncTerrainPatchBuilder()

  public acquire(): void {}
  public release(): void {}
  public releaseAll(): void {}
  public dispose(): void {}

  public request(job: PatchBuildJob, onDone: (result: PatchBuildResult) => void, onError: (error: unknown) => void): void {
    this.queue.push([job, onDone, onError])
  }

  public requestShadow(): void {}

  public requestNearTile(): void {}

  public flush(count: number): void {
    for (const [job, onDone, onError] of this.queue.splice(0, count)) {
      this.built++
      this.sync.request(job, onDone, onError)
    }
  }
}

class TestPatchGroup extends TerrainPatchGroup {
  public constructor(field: TerrainHeightField, material: TerrainMaterial, renderer: WebGLRenderer, builder: TerrainPatchBuilder) {
    super(field, material, renderer, undefined, undefined, undefined, () => 0, builder)
  }

  public get wantedCount(): number {
    return (this as unknown as { lastWanted: Map<number, unknown> }).lastWanted.size
  }
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// Сценарий ревью 2026-09-26: 2160p, 2 км над Луной, взгляд вниз под 0.6 рад —
// желаемый набор без клапана ≈ 1.2 тыс. листьев, больше пула (1024)
describe.skipIf(!existsSync(MOON_HEIGHT_PATH))('Клапан пула на карте Луны: неподвижная камера у поверхности', () => {
  it('набор сходится без предельного цикла, пересборки прекращаются', { timeout: 600000 }, () => {
    const moon = Actor.find(19)!
    for (const name of ['', 'default.png', 'night.jpg', moon.resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string]) {
      seedTexture(name)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const buffer = readFileSync(MOON_HEIGHT_PATH)
    const map = parseHeightMap(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
    const builder = new QueuedBuilder()
    const group = new TestPatchGroup(
      new TerrainHeightField(map, RADIUS_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 }),
      new TerrainMaterial(moon),
      { domElement: { height: 2160 } } as unknown as WebGLRenderer,
      builder
    )
    builder.flush(24)

    const up = new Vector3(1, 0, 0)
    const pitch = 0.6
    const camera = new PerspectiveCamera(50, 16 / 9, 1e-7, 1e9)
    camera.position.copy(up).multiplyScalar(toThreeJSUnits(RADIUS_KM + 2))
    camera.up.copy(up)
    camera.lookAt(camera.position.clone().add(new Vector3(0, 0, Math.cos(pitch)).addScaledVector(up, -Math.sin(pitch))))
    camera.updateMatrixWorld(true)
    const ctx = { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext

    for (let f = 0; f < 600; f++) {
      group.updateObject(ctx)
      builder.flush(3)
    }

    const builtBefore = builder.built
    const wanted: number[] = []
    const visible: number[] = []
    for (let f = 0; f < 200; f++) {
      group.updateObject(ctx)
      builder.flush(3)
      wanted.push(group.wantedCount)
      visible.push(group.children.filter((c) => c instanceof Mesh && c.visible).length)
    }

    expect(builder.built - builtBefore).toBe(0)
    expect(Math.max(...wanted) - Math.min(...wanted)).toBe(0)
    expect(Math.max(...visible) - Math.min(...visible)).toBe(0)
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('пул патчей исчерпан'))
    warn.mockRestore()
    resourceStorage.deleteAllTextures()
  })
})
