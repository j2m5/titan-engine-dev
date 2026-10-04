import { ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, RedFormat, Vector3 } from 'three'
import type { TerrainConfig } from '@/config/terrain'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { TerrainHeightField } from './TerrainHeightField'
import type { TerrainPatchBuilder } from './terrainPatchBuilder'
import { nearAltitudeWeight, nearCameraXYInto, nearTileBasis, type Vec3 } from './terrainNearShadowMath'

export type NearShadowTileConfig = TerrainConfig['terrain']['nearShadow']

/** Плитка для материала: центр/базис/текстура меняются вместе, только на приходе новой плитки; веса и cameraXY — каждый кадр. */
export interface NearTileState {
  /** R32F texels², метры относительно центра; строка 0 — юг, столбец 0 — запад. */
  texture: DataTexture
  center: Vec3
  east: Vec3
  north: Vec3
  texelMeters: number
  texels: number
  /** Вес по высоте камеры, [0, 1]; пересчитывается каждый кадр. */
  altitudeWeight: number
  /** Подкамерная точка в метрах плитки (dirToTile), пишется на месте каждый кадр. */
  cameraXY: [number, number]
}

/**
 * Владелец плитки ближней тени одного тела. Инварианты: не больше одного
 * запроса в полёте; ответ с устаревшим номером отбрасывается; пока печётся
 * новая плитка, отдаётся старая; текстуру диспозит только этот класс
 * (замена, выход за порог высоты, release/dispose).
 */
export class NearShadowTile {
  private state: NearTileState | null = null
  /** Номер последнего запроса; release/dispose его сдвигают — ответы в полёте устаревают. */
  private generation = 0
  private inFlight = false
  /** Центр последнего завершённого запроса (успех или отказ) — от него меряется сдвиг. */
  private anchor: Vec3 | null = null
  private disposed = false
  private warned = false
  private readonly dirScratch = new Vector3()
  private readonly dirTuple: Vec3 = [0, 0, 0]
  private readonly metersPerUnit = 1000 / toThreeJSUnits(1)

  public constructor(
    private readonly field: TerrainHeightField,
    private readonly builder: Pick<TerrainPatchBuilder, 'requestNearTile'>,
    private readonly config: NearShadowTileConfig
  ) {}

  /** cameraLocal — позиция камеры в системе тела, юниты сцены. null — плитки нет (выше порога или ещё не пришла). */
  public update(cameraLocal: Vector3): NearTileState | null {
    if (this.disposed) return null

    const distance = cameraLocal.length()
    if (distance === 0) return this.state
    const dir = this.dirScratch.copy(cameraLocal).divideScalar(distance)
    const altitudeMeters = (distance - this.field.surfaceRadiusUnits(dir)) * this.metersPerUnit
    if (altitudeMeters >= this.config.maxAltitudeMeters) {
      this.release()

      return null
    }

    if (!this.inFlight && this.needsRebake(dir)) this.request([dir.x, dir.y, dir.z])

    if (this.state) {
      const s = this.state
      s.altitudeWeight = nearAltitudeWeight(altitudeMeters, this.config.fadeAltitudeMeters, this.config.maxAltitudeMeters)
      const d = this.dirTuple
      d[0] = dir.x
      d[1] = dir.y
      d[2] = dir.z
      nearCameraXYInto(d, s.center, s.east, s.north, this.field.radiusKm * 1000, s.cameraXY)
    }

    return this.state
  }

  /** Снимает плитку и запрос в полёте; следующий update начнёт заново. */
  public release(): void {
    this.generation++
    this.inFlight = false
    this.anchor = null
    this.state?.texture.dispose()
    this.state = null
  }

  public dispose(): void {
    this.release()
    this.disposed = true
  }

  /** Сдвиг подспутниковой точки по дуге, м, против rebakeFraction · окна. */
  private needsRebake(dir: Vector3): boolean {
    if (!this.anchor) return true
    const a = this.anchor
    const cos = Math.min(Math.max(dir.x * a[0] + dir.y * a[1] + dir.z * a[2], -1), 1)
    const arcMeters = Math.acos(cos) * this.field.radiusKm * 1000
    const { rebakeFraction, tileTexels, texelMeters } = this.config

    return arcMeters > rebakeFraction * tileTexels * texelMeters
  }

  private request(center: Vec3): void {
    const generation = ++this.generation
    const { east, north } = nearTileBasis(center)
    const { tileTexels: texels, texelMeters } = this.config
    this.inFlight = true

    // синхронный строитель отвечает внутри вызова — состояние готово до него
    this.builder.requestNearTile(
      this.field,
      { center, east, north, texels, texelMeters },
      (heights) => {
        if (generation !== this.generation) return
        this.inFlight = false
        this.anchor = center
        this.install(heights, center, east, north)
      },
      (error) => {
        if (generation !== this.generation) return
        this.inFlight = false
        // повтор — только после сдвига за порог, не каждый кадр
        this.anchor = center
        if (!this.warned) console.warn('[NearShadowTile] плитка ближней тени не построена', error)
        this.warned = true
      }
    )
  }

  private install(heights: Float32Array, center: Vec3, east: Vec3, north: Vec3): void {
    const { tileTexels: texels, texelMeters } = this.config
    const texture = new DataTexture(heights, texels, texels, RedFormat, FloatType)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.wrapS = ClampToEdgeWrapping
    texture.wrapT = ClampToEdgeWrapping
    texture.generateMipmaps = false
    texture.needsUpdate = true

    this.state?.texture.dispose()
    this.state = { texture, center, east, north, texelMeters, texels, altitudeWeight: 0, cameraXY: [0, 0] }
  }
}
