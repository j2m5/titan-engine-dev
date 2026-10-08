import { ClampToEdgeWrapping, PerspectiveCamera, RepeatWrapping, Texture, Vector2, WebGLRenderer } from 'three'
import { Resources } from '@storage/database'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import type { Actor } from '@/core/models/Actor'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import type { IAsteroidBeltRenderingObject, IRingRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'

/**
 * Стример пояса строится лениво, на первом подлёте. Всё тяжёлое, что он делал
 * синхронно в этом кадре, перенесено на сборку сцены: бейк форм камней —
 * прогревом кэша библиотеки архетипов, а перезаливка общих 2K-текстур деталей
 * снята вовсе — Repeat теперь в данных ресурса, прелоад заливает с ним.
 */

const { buildSpy } = vi.hoisted(() => ({ buildSpy: vi.fn() }))

vi.mock(
  '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeGeometry',
  async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const actual = await importOriginal()
    const build = actual.buildArchetypeGeometry as (...args: unknown[]) => unknown

    return {
      ...actual,
      buildArchetypeGeometry: (...args: unknown[]): unknown => {
        buildSpy(...args)
        return build(...args)
      }
    }
  }
)

const fakeRenderer = {
  getSize: (v: Vector2) => v.set(1920, 1080),
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function makeFactory(): RenderableFactory {
  return new RenderableFactory(
    fakeRenderer,
    {} as unknown as ResourceObserver,
    new AtmosphereRegistry(),
    new DepthVolumeRegistry()
  )
}

function beltActor(data: IAsteroidBeltRenderingObject): Actor {
  return {
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (key: string, fallback: unknown = ''): unknown => {
      if (key === 'categoryId') return 11
      if (key === 'name') return 'Prewarm Belt'
      return fallback
    }
  } as unknown as Actor
}

function ringActor(): Actor {
  const data: Partial<IRingRenderingObject> = { innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1 }

  return {
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => data },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  } as unknown as Actor
}

// Габарит, которого нет у других тестов: кэш модульный, ключ обязан быть холодным
const BELT_DATA: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  sizeRangeKm: [0.5, 61.25],
  spacingKm: 54,
  dustEnabled: false
}

function frameAt(belt: AsteroidBelt, x: number): void {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)

  camera.position.set(x, 0, 0)
  camera.updateMatrixWorld(true)
  belt.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)
}

describe('Пояс: формы камней печёт сборка сцены, а не кадр подлёта', () => {
  it('сборка пояса печёт оба яруса архетипов; создание стримера на подлёте ничего не печёт', () => {
    buildSpy.mockClear()

    const node = makeFactory().make(beltActor(BELT_DATA)) as PlacedNode
    const belt = node.children.find((c) => c instanceof AsteroidBelt) as unknown as AsteroidBelt
    const baked = buildSpy.mock.calls.length

    expect((belt as unknown as { streamer: unknown }).streamer).toBeNull()
    expect(baked).toBeGreaterThan(0)

    node.updateMatrixWorld(true)
    frameAt(belt, fromAstronomicalUnits(50))

    expect((belt as unknown as { streamer: unknown }).streamer).not.toBeNull()
    expect(buildSpy).toHaveBeenCalledTimes(baked)
  })

  it('прогрев считает ключи тем же resolveConfig, что и система: оба яруса detail', () => {
    const cfg = AsteroidRingSystem.resolveConfig(beltActor(BELT_DATA), { asteroidSizeKm: 77.5 })

    buildSpy.mockClear()
    AsteroidRingSystem.prewarmArchetypes(beltActor(BELT_DATA), { asteroidSizeKm: 77.5 })

    const details = buildSpy.mock.calls.map((call: unknown[]) => call[1])

    expect(details.filter((d) => d === cfg.asteroidShapeDetail)).toHaveLength(cfg.archetypeCount)
    expect(details.filter((d) => d === cfg.asteroidShapeNearDetail)).toHaveLength(cfg.archetypeCount)
  })
})

describe('Текстуры деталей камней: Repeat из данных, без перезаливки на подлёте', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('в данных у всех asteroids/*_2k.jpg — Repeat по обеим осям', () => {
    const rocks = Resources.filter((r) => /^asteroids\/.*_2k\.jpg$/.test(r.path))

    expect(rocks.length).toBeGreaterThan(0)
    for (const r of rocks) {
      expect(r.wrapS).toBe(RepeatWrapping)
      expect(r.wrapT).toBe(RepeatWrapping)
    }
  })

  function seedDetailMaps(wrap: typeof RepeatWrapping | typeof ClampToEdgeWrapping): Texture[] {
    const set = ASTEROID_PROFILES.stony.detailSet

    return ['diff', 'nor_gl', 'arm'].map((kind: string): Texture => {
      const texture = new Texture()

      texture.name = `asteroids/${set}_${kind}_2k.jpg`
      texture.wrapS = texture.wrapT = wrap
      resourceStorage.addTexture(texture)

      return texture
    })
  }

  it('уже Repeat — версия текстур не меняется (нет перезаливки), карты в юниформах', () => {
    const maps = seedDetailMaps(RepeatWrapping)
    const versions = maps.map((t) => t.version)
    const system = new AsteroidRingSystem(ringActor())
    const u = (system as unknown as { pool: { geometryMaterial: { uniforms: Record<string, { value: unknown }> } } })
      .pool.geometryMaterial.uniforms

    expect(maps.map((t) => t.version)).toEqual(versions)
    expect(u.uRockDiffMap.value).toBe(maps[0])
    expect(u.uDetailMapsEnabled.value).toBe(1)
  })

  it('данные без Repeat — wrap выставляется и текстура перезаливается, как раньше', () => {
    const maps = seedDetailMaps(ClampToEdgeWrapping)
    const versions = maps.map((t) => t.version)

    new AsteroidRingSystem(ringActor())

    maps.forEach((t, i) => {
      expect(t.wrapS).toBe(RepeatWrapping)
      expect(t.wrapT).toBe(RepeatWrapping)
      expect(t.version).toBeGreaterThan(versions[i])
    })
  })
})
