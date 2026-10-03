import { describe, expect, it } from 'vitest'
import { ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, RedFormat, Vector3 } from 'three'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { NearShadowTile, type NearShadowTileConfig } from '@/core/terrain/NearShadowTile'
import type { NearTileParams } from '@/core/terrain/nearTileBake'
import { dirToTile, nearAltitudeWeight, nearTileBasis, type Vec3 } from '@/core/terrain/terrainNearShadowMath'
import { SyncTerrainPatchBuilder, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'

const RADIUS_KM = 1737.4
const UNITS_PER_METER = toThreeJSUnits(1) / 1000

// ненулевой рельеф: высота камеры обязана мериться от поверхности, не от датума
function makeField(): TerrainHeightField {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height).fill(65535)
  const map: HeightMapData = { width, height, minMeters: 0, maxMeters: 5000, data }

  return new TerrainHeightField(map, RADIUS_KM)
}

// малая плитка — тесты владения не платят за 512² бейк; порог перепечки — четверть окна (8192 м)
const SMALL: NearShadowTileConfig = { ...config('terrain.nearShadow'), tileTexels: 8, texelMeters: 4096, rebakeFraction: 0.25 }

type Pending = { params: NearTileParams; onDone: (h: Float32Array) => void; onError: (e: unknown) => void }

/** Ручное продвижение ответов: плитка в полёте, пока тест не позовёт reply/fail. */
class QueuedNearBuilder implements Pick<TerrainPatchBuilder, 'requestNearTile'> {
  public readonly pending: Pending[] = []
  public requests = 0

  public requestNearTile(_f: TerrainHeightField, params: NearTileParams, onDone: (h: Float32Array) => void, onError: (e: unknown) => void): void {
    this.requests++
    this.pending.push({ params, onDone, onError })
  }

  public reply(): void {
    const p = this.pending.shift()!
    p.onDone(new Float32Array(p.params.texels * p.params.texels))
  }

  public fail(): void {
    this.pending.shift()!.onError(new Error('нет поля'))
  }
}

/** Синхронный строитель со счётчиком запросов. */
class CountingSyncBuilder implements Pick<TerrainPatchBuilder, 'requestNearTile'> {
  public readonly params: NearTileParams[] = []
  private readonly sync = new SyncTerrainPatchBuilder()

  public requestNearTile(f: TerrainHeightField, params: NearTileParams, onDone: (h: Float32Array) => void, onError: (e: unknown) => void): void {
    this.params.push(params)
    this.sync.requestNearTile(f, params, onDone, onError)
  }
}

/** Камера на altitudeMeters над поверхностью в направлении, повёрнутом на arcMeters к востоку от +X. */
function cameraAt(field: TerrainHeightField, altitudeMeters: number, arcMeters: number = 0): Vector3 {
  const angle = arcMeters / (RADIUS_KM * 1000)
  const dir = new Vector3(Math.cos(angle), 0, -Math.sin(angle))

  return dir.multiplyScalar(field.surfaceRadiusUnits(dir) + altitudeMeters * UNITS_PER_METER)
}

describe('NearShadowTile: порог высоты и первый запрос', () => {
  it('выше maxAltitudeMeters — null и ни одного запроса', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const tile = new NearShadowTile(field, builder, SMALL)
    expect(tile.update(cameraAt(field, 60000))).toBeNull()
    expect(builder.requests).toBe(0)
  })

  it('ниже порога — запрос с центром в подспутниковой точке; после ответа — R32F 512² по конфигу', () => {
    const field = makeField()
    const builder = new CountingSyncBuilder()
    const tile = new NearShadowTile(field, builder, config('terrain.nearShadow'))
    const camera = new Vector3(1, 0.4, -0.3).normalize()
    const dir = camera.clone()
    camera.multiplyScalar(field.surfaceRadiusUnits(dir) + 2000 * UNITS_PER_METER)

    const state = tile.update(camera)!
    expect(builder.params).toHaveLength(1)
    const p = builder.params[0]
    expect(p.center[0]).toBeCloseTo(dir.x, 12)
    expect(p.center[1]).toBeCloseTo(dir.y, 12)
    expect(p.center[2]).toBeCloseTo(dir.z, 12)
    const basis = nearTileBasis(p.center)
    expect(p.east).toEqual(basis.east)
    expect(p.north).toEqual(basis.north)
    expect(p.texels).toBe(512)
    expect(p.texelMeters).toBe(64)

    expect(state.texture).toBeInstanceOf(DataTexture)
    expect(state.texture.image.width).toBe(512)
    expect(state.texture.image.height).toBe(512)
    expect(state.texture.format).toBe(RedFormat)
    expect(state.texture.type).toBe(FloatType)
    expect(state.texture.minFilter).toBe(LinearFilter)
    expect(state.texture.magFilter).toBe(LinearFilter)
    expect(state.texture.wrapS).toBe(ClampToEdgeWrapping)
    expect(state.texture.wrapT).toBe(ClampToEdgeWrapping)
    expect(state.texture.generateMipmaps).toBe(false)
    expect(state.texture.version).toBeGreaterThan(0)
    expect(state.center).toEqual(p.center)
    expect(state.east).toEqual(p.east)
    expect(state.north).toEqual(p.north)
    expect(state.texels).toBe(512)
    expect(state.texelMeters).toBe(64)
    tile.dispose()
  })

  it('altitudeWeight — по высоте над поверхностью под камерой (не над датумом)', () => {
    const field = makeField()
    const tile = new NearShadowTile(field, new CountingSyncBuilder(), SMALL)
    expect(tile.update(cameraAt(field, 40000))!.altitudeWeight).toBeCloseTo(nearAltitudeWeight(40000, 30000, 50000), 6)
    expect(tile.update(cameraAt(field, 10000))!.altitudeWeight).toBe(1)
    tile.dispose()
  })

  it('cameraXY — подкамерная точка в координатах плитки, каждый кадр, без перепечки и без новой ссылки', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const tile = new NearShadowTile(field, builder, SMALL)
    tile.update(cameraAt(field, 2000))
    builder.reply()
    const state = tile.update(cameraAt(field, 2000))!
    const xy = state.cameraXY
    expect(xy[0]).toBeCloseTo(0, 6)
    expect(xy[1]).toBeCloseTo(0, 6)

    const moved = tile.update(cameraAt(field, 2000, 3000))!
    expect(builder.requests).toBe(1)
    expect(moved.cameraXY).toBe(xy)
    const R = RADIUS_KM * 1000
    const d: Vec3 = [Math.cos(3000 / R), 0, -Math.sin(3000 / R)]
    const [ex, ey] = dirToTile(d, state.center, state.east, state.north, R)
    expect(xy[0]).toBeCloseTo(ex, 6)
    expect(xy[1]).toBeCloseTo(ey, 6)
    // восток от +X — вдоль E плитки
    expect(xy[0]).toBeGreaterThan(2999)
    tile.dispose()
  })

  it('порог перепечки — rebakeFraction конфига по умолчанию (не четверть окна SMALL)', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const c = config('terrain.nearShadow')
    const tile = new NearShadowTile(field, builder, c)
    tile.update(cameraAt(field, 2000))
    builder.reply()
    const threshold = c.rebakeFraction * c.tileTexels * c.texelMeters
    tile.update(cameraAt(field, 2000, threshold - 20))
    expect(builder.requests).toBe(1)
    tile.update(cameraAt(field, 2000, threshold + 20))
    expect(builder.requests).toBe(2)
    tile.dispose()
  })
})

describe('NearShadowTile: перепечка и запросы в полёте', () => {
  // окно SMALL = 8 · 4096 = 32 768 м, порог перепечки 8192 м
  it('сдвиг меньше четверти окна — без перепечки; больше — новый запрос, старая плитка до ответа', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const tile = new NearShadowTile(field, builder, SMALL)
    expect(tile.update(cameraAt(field, 2000))).toBeNull()
    builder.reply()
    const first = tile.update(cameraAt(field, 2000))!
    const firstTexture = first.texture
    const firstCenter = [...first.center]

    expect(tile.update(cameraAt(field, 2000, 6000))!.texture).toBe(firstTexture)
    expect(builder.requests).toBe(1)

    const moved = tile.update(cameraAt(field, 2000, 10000))!
    expect(builder.requests).toBe(2)
    expect(moved.texture).toBe(firstTexture)
    expect(moved.center).toEqual(firstCenter)

    builder.reply()
    const next = tile.update(cameraAt(field, 2000, 10000))!
    expect(next.texture).not.toBe(firstTexture)
    expect(next.center[2]).toBeCloseTo(-Math.sin(10000 / (RADIUS_KM * 1000)), 9)
    tile.dispose()
  })

  it('два сдвига подряд — второй запрос не уходит, пока первый в полёте', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const tile = new NearShadowTile(field, builder, SMALL)
    tile.update(cameraAt(field, 2000))
    builder.reply()
    tile.update(cameraAt(field, 2000))
    tile.update(cameraAt(field, 2000, 10000))
    tile.update(cameraAt(field, 2000, 20000))
    expect(builder.requests).toBe(2)
    builder.reply()
    // пришла плитка центра 10 км; камера на 20 км — сдвиг 10 км > 8192 м, новый запрос
    tile.update(cameraAt(field, 2000, 20000))
    expect(builder.requests).toBe(3)
    tile.dispose()
  })

  it('выход за порог и dispose диспозят текстуру', () => {
    const field = makeField()
    const tile = new NearShadowTile(field, new CountingSyncBuilder(), SMALL)
    let disposed = 0
    tile.update(cameraAt(field, 2000))!.texture.addEventListener('dispose', () => disposed++)
    expect(tile.update(cameraAt(field, 60000))).toBeNull()
    expect(disposed).toBe(1)

    tile.update(cameraAt(field, 2000))!.texture.addEventListener('dispose', () => disposed++)
    tile.dispose()
    expect(disposed).toBe(2)
  })

  it('новая плитка диспозит прежнюю текстуру', () => {
    const field = makeField()
    const tile = new NearShadowTile(field, new CountingSyncBuilder(), SMALL)
    let disposed = 0
    tile.update(cameraAt(field, 2000))!.texture.addEventListener('dispose', () => disposed++)
    tile.update(cameraAt(field, 2000, 10000))
    expect(disposed).toBe(1)
    tile.dispose()
  })

  it('ответ после dispose не ставится', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const tile = new NearShadowTile(field, builder, SMALL)
    tile.update(cameraAt(field, 2000))
    tile.dispose()
    builder.reply()
    expect(tile.update(cameraAt(field, 2000))).toBeNull()
    expect(builder.requests).toBe(1)
  })

  it('ответ, перекрытый выходом за порог и новым запросом, отбрасывается', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const tile = new NearShadowTile(field, builder, SMALL)
    tile.update(cameraAt(field, 2000))
    tile.update(cameraAt(field, 60000))
    tile.update(cameraAt(field, 2000, 30000))
    expect(builder.requests).toBe(2)

    builder.reply() // устаревший — центр у +X
    expect(tile.update(cameraAt(field, 2000, 30000))).toBeNull()
    builder.reply()
    const state = tile.update(cameraAt(field, 2000, 30000))!
    expect(state.center[2]).toBeCloseTo(-Math.sin(30000 / (RADIUS_KM * 1000)), 9)
    tile.dispose()
  })

  it('отказ строителя — без плитки и без повтора, пока камера не сдвинется за порог', () => {
    const field = makeField()
    const builder = new QueuedNearBuilder()
    const tile = new NearShadowTile(field, builder, SMALL)
    tile.update(cameraAt(field, 2000))
    builder.fail()
    expect(tile.update(cameraAt(field, 2000))).toBeNull()
    expect(builder.requests).toBe(1)
    tile.update(cameraAt(field, 2000, 10000))
    expect(builder.requests).toBe(2)
    tile.dispose()
  })
})
