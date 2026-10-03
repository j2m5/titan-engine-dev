import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTexture, Group, PerspectiveCamera, Texture, Vector3, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { terrainShadowMarchUniforms } from '@/core/materials/shaders/lib/chunks/TerrainShadowMarch'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { disposeTerrainShadowMaps } from '@/core/terrain/terrainShadowMap'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { NearShadowTile, type NearTileState } from '@/core/terrain/NearShadowTile'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { SyncTerrainPatchBuilder, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import type { NearTileParams } from '@/core/terrain/nearTileBake'
import type { UpdateContext } from '@/core/UpdateContext'

// ORM отдаёт новый экземпляр связи на каждое обращение — подмена на уровне резолвера (см. TerrainShadowWiring.spec)
const lightOverride = vi.hoisted(() => ({ near: undefined as number | undefined }))

vi.mock('@/core/terrain/terrainLightParams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/terrain/terrainLightParams')>()

  return {
    ...actual,
    resolveTerrainLightParams: (data: Parameters<typeof actual.resolveTerrainLightParams>[0], context: string) => {
      const params = actual.resolveTerrainLightParams(data, context)

      return lightOverride.near === undefined ? params : { ...params, nearShadowStrength: lightOverride.near }
    }
  }
})

const MOON_ID = 19
const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'
const RADIUS_KM = 1737.4

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

function seedHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(MOON_HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

/** Синхронный строитель, притворяющийся воркерным: плитка бейкается внутри запроса. */
class OffThreadBuilder extends SyncTerrainPatchBuilder {
  public override get offThread(): boolean {
    return true
  }
}

/** Воркерный строитель с отложенным ответом плитки: onDone копится в pending. */
class DeferredNearBuilder extends OffThreadBuilder {
  public readonly pending: Array<(heights: Float32Array) => void> = []

  public override requestNearTile(_field: TerrainHeightField, _params: NearTileParams, onDone: (heights: Float32Array) => void): void {
    this.pending.push(onDone)
  }
}

function makeState(): NearTileState {
  return {
    texture: new DataTexture(new Float32Array(4), 2, 2),
    center: [1, 0, 0],
    east: [0, 0, -1],
    north: [0, 1, 0],
    texelMeters: 64,
    texels: 512,
    altitudeWeight: 0.8
  }
}

function makeCtx(altKm: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  camera.position.set(toThreeJSUnits(RADIUS_KM + altKm), 0, 0)
  camera.updateMatrixWorld(true)

  return { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext
}

const NEAR_UNIFORMS: Array<[string, string]> = [
  ['sampler2D', 'uNearTile'],
  ['vec3', 'uNearTileCenter'],
  ['vec3', 'uNearTileEast'],
  ['vec3', 'uNearTileNorth'],
  ['float', 'uNearTileTexelMeters'],
  ['float', 'uNearTileTexels'],
  ['float', 'uNearTileWeight'],
  ['float', 'uNearShadowMaxDistMeters'],
  ['float', 'uBodyRadiusMeters']
]

describe('PlanetShaderTemplate: юниформы ближней тени', () => {
  it('объявлены в чанке юниформ марша — он включён только под USE_TERRAIN_SHADOW', () => {
    for (const [type, name] of NEAR_UNIFORMS) expect(terrainShadowMarchUniforms).toContain(`uniform ${type} ${name};`)
    const frag: string = PlanetShaderTemplate.fragmentShader
    const start = frag.indexOf('#ifdef USE_TERRAIN_SHADOW')
    expect(frag.slice(start, frag.indexOf('#endif', start))).toContain('#include <terrainShadowMarchUniforms>')
  })

  it('дефолты шаблона: плитки нет, вес 0', () => {
    const u = PlanetShaderTemplate.uniforms!
    expect(u.uNearTile.value).toBeNull()
    expect(u.uNearTileWeight.value).toBe(0)
    for (const [, name] of NEAR_UNIFORMS) expect(u[name]).toBeDefined()
  })
})

describe('PlanetMaterial.setNearTile', () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    seedHeightMap()
  })

  afterEach(() => {
    lightOverride.near = undefined
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    disposeTerrainShadowMaps()
  })

  it('дефолты материала: вес 0, текстуры нет, дальность и радиус из конфига и тела', () => {
    const material = new PlanetMaterial(moon(), undefined, { terrainPatches: true })
    for (const [, name] of NEAR_UNIFORMS) expect(material.uniforms[name]).toBeDefined()
    expect(material.uniforms.uNearTileWeight.value).toBe(0)
    expect(material.uniforms.uNearTile.value).toBeNull()
    expect(material.uniforms.uNearShadowMaxDistMeters.value).toBe(config('terrain.nearShadow').maxDistanceMeters)
    const radiusKm = moon().physicalObject!.getAttribute('radius') as number
    expect(material.uniforms.uBodyRadiusMeters.value).toBe(radiusKm * 1000)
  })

  it('со state — все юниформы, вес = altitudeWeight · nearShadowStrength; null — вес 0 и текстура null', () => {
    lightOverride.near = 0.5
    const material = new PlanetMaterial(moon(), undefined, { terrainPatches: true })
    material.updateMaterial()
    const state = makeState()
    material.setNearTile(state)
    const u = material.uniforms
    expect(u.uNearTile.value).toBe(state.texture)
    expect((u.uNearTileCenter.value as Vector3).toArray()).toEqual(state.center)
    expect((u.uNearTileEast.value as Vector3).toArray()).toEqual(state.east)
    expect((u.uNearTileNorth.value as Vector3).toArray()).toEqual(state.north)
    expect(u.uNearTileTexelMeters.value).toBe(64)
    expect(u.uNearTileTexels.value).toBe(512)
    expect(u.uNearTileWeight.value).toBeCloseTo(0.4, 12)

    material.setNearTile(null)
    expect(u.uNearTileWeight.value).toBe(0)
    expect(u.uNearTile.value).toBeNull()
  })

  it('nearShadowActive — только при USE_TERRAIN_SHADOW и nearShadowStrength > 0', () => {
    const material = new PlanetMaterial(moon(), undefined, { terrainPatches: true })
    expect(material.nearShadowActive).toBe(false)
    material.updateMaterial()
    expect(material.nearShadowActive).toBe(true)
    lightOverride.near = 0
    material.updateMaterial()
    expect(material.nearShadowActive).toBe(false)
  })

  it('resetMaterial снимает плитку', () => {
    const material = new PlanetMaterial(moon(), undefined, { terrainPatches: true })
    material.updateMaterial()
    material.setNearTile(makeState())
    material.resetMaterial()
    expect(material.uniforms.uNearTileWeight.value).toBe(0)
    expect(material.uniforms.uNearTile.value).toBeNull()
  })
})

describe('TerrainSphere: кадр ведёт плитку ближней тени', { timeout: 30000 }, () => {
  beforeEach(() => {
    seedPlaceholderKeys()
    seedHeightMap()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    disposeTerrainShadowMaps()
  })

  function makeSphere(builder: TerrainPatchBuilder = new OffThreadBuilder()): TerrainSphere {
    const map = heightFieldStorage.get(MOON_HEIGHT_PATH)!
    const sphere = new TerrainSphere(
      moon(),
      new TerrainHeightField(map, RADIUS_KM),
      { domElement: { height: 1080 } } as unknown as WebGLRenderer,
      undefined,
      undefined,
      undefined,
      builder
    )
    sphere.material.updateMaterial()

    return sphere
  }

  it('onVisibleUpdate зовёт update плитки и setNearTile; у поверхности плитка в материале', () => {
    const sphere = makeSphere()
    const update = vi.spyOn(NearShadowTile.prototype, 'update')
    const setNearTile = vi.spyOn(PlanetMaterial.prototype, 'setNearTile')
    sphere.updateObject(makeCtx(2))
    expect(update).toHaveBeenCalledTimes(1)
    const local = update.mock.calls[0][0]
    expect(local.x).toBeCloseTo(toThreeJSUnits(RADIUS_KM + 2), 9)
    expect(setNearTile).toHaveBeenCalledTimes(1)
    expect(sphere.material.uniforms.uNearTile.value).toBeInstanceOf(DataTexture)
    expect(sphere.material.uniforms.uNearTileWeight.value).toBe(1)
    sphere.dispose()
  })

  it('камера в системе тела: поворот тела поворачивает подспутниковую точку', () => {
    const sphere = makeSphere()
    sphere.rotation.y = Math.PI / 2
    sphere.updateMatrixWorld(true)
    const update = vi.spyOn(NearShadowTile.prototype, 'update')
    sphere.updateObject(makeCtx(2))
    const local = update.mock.calls[0][0]
    expect(local.x).toBeCloseTo(0, 9)
    expect(Math.abs(local.z)).toBeCloseTo(toThreeJSUnits(RADIUS_KM + 2), 9)
    sphere.dispose()
  })

  it('высоко — плитки нет, вес 0', () => {
    const sphere = makeSphere()
    sphere.updateObject(makeCtx(500))
    expect(sphere.material.uniforms.uNearTile.value).toBeNull()
    expect(sphere.material.uniforms.uNearTileWeight.value).toBe(0)
    sphere.dispose()
  })

  it('слой выключен (nearShadowStrength 0) — плитка не печётся', () => {
    lightOverride.near = 0
    try {
      const sphere = makeSphere()
      const update = vi.spyOn(NearShadowTile.prototype, 'update')
      sphere.updateObject(makeCtx(2))
      expect(update).not.toHaveBeenCalled()
      expect(sphere.material.uniforms.uNearTileWeight.value).toBe(0)
      sphere.dispose()
    } finally {
      lightOverride.near = undefined
    }
  })

  it('строитель без воркера (offThread=false) — плитка не запрашивается и не создаётся', () => {
    const builder = new SyncTerrainPatchBuilder()
    const request = vi.spyOn(builder, 'requestNearTile')
    const sphere = makeSphere(builder)
    sphere.updateObject(makeCtx(2))
    expect(request).not.toHaveBeenCalled()
    expect(sphere.material.uniforms.uNearTile.value).toBeNull()
    expect(sphere.material.uniforms.uNearTileWeight.value).toBe(0)
    sphere.dispose()
  })

  it('строитель с воркером (offThread=true) — плитка запрашивается и приходит', () => {
    const builder = new OffThreadBuilder()
    const request = vi.spyOn(builder, 'requestNearTile')
    const sphere = makeSphere(builder)
    sphere.updateObject(makeCtx(2))
    expect(request).toHaveBeenCalledTimes(1)
    expect(sphere.material.uniforms.uNearTile.value).toBeInstanceOf(DataTexture)
    sphere.dispose()
  })

  it('слой выключен в живую (strength → 0) — текстура плитки освобождена, материал её не держит', () => {
    const sphere = makeSphere()
    sphere.updateObject(makeCtx(2))
    const texture = sphere.material.uniforms.uNearTile.value as DataTexture
    let disposed = 0
    texture.addEventListener('dispose', () => disposed++)
    lightOverride.near = 0
    try {
      sphere.material.updateMaterial()
      sphere.updateObject(makeCtx(2))
    } finally {
      lightOverride.near = undefined
    }
    expect(disposed).toBe(1)
    expect(sphere.material.uniforms.uNearTile.value).toBeNull()
    sphere.dispose()
  })

  it.each(['сама сфера', 'родитель'])('скрытое тело (%s) освобождает плитку', (who) => {
    const sphere = makeSphere()
    const parent = new Group()
    parent.add(sphere)
    sphere.updateObject(makeCtx(2))
    const texture = sphere.material.uniforms.uNearTile.value as DataTexture
    let disposed = 0
    texture.addEventListener('dispose', () => disposed++)
    if (who === 'сама сфера') sphere.visible = false
    else parent.visible = false
    sphere.updateObject(makeCtx(2))
    expect(disposed).toBe(1)
    expect(sphere.material.uniforms.uNearTile.value).toBeNull()
    // повторный скрытый кадр — без повторного dispose
    sphere.updateObject(makeCtx(2))
    expect(disposed).toBe(1)
    sphere.dispose()
  })

  it('ответ плитки в полёте после скрытия не создаёт текстуру', () => {
    const builder = new DeferredNearBuilder()
    const sphere = makeSphere(builder)
    sphere.updateObject(makeCtx(2))
    expect(builder.pending).toHaveLength(1)
    sphere.visible = false
    sphere.updateObject(makeCtx(2))
    const textureDispose = vi.spyOn(DataTexture.prototype, 'dispose')
    builder.pending[0](new Float32Array(512 * 512))
    expect((sphere as unknown as { nearTile: { state: unknown } }).nearTile.state).toBeNull()
    expect(sphere.material.uniforms.uNearTile.value).toBeNull()
    expect(textureDispose).not.toHaveBeenCalled()
    sphere.dispose()
  })

  it('dispose сферы диспозит текстуру плитки и снимает её с материала', () => {
    const sphere = makeSphere()
    sphere.updateObject(makeCtx(2))
    const texture = sphere.material.uniforms.uNearTile.value as DataTexture
    let disposed = 0
    texture.addEventListener('dispose', () => disposed++)
    sphere.dispose()
    expect(disposed).toBe(1)
    expect(sphere.material.uniforms.uNearTile.value).toBeNull()
  })
})
