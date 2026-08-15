import { Vector2, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { HeightMapData } from './heightMapFormat'

/**
 * Разрешение честной сферы рельефа. Машинерия, не визуальная ручка — потому
 * в коде, а не в renderingObject.data (конвенция колец). 1024 сегмента для
 * Луны ≈ 10.6 км/вершину на экваторе — ниже доложит slope-карта, а с этапа 3 —
 * квадродерево.
 */
export const TERRAIN_SPHERE_SEGMENTS = 1024

const TWO_PI = 2 * Math.PI

/**
 * Канонический владелец высот тела: единственный ответ на вопрос «какова
 * высота поверхности в направлении dir̂». Мешер (buildDisplacedSphere) и
 * коллизия (CameraCollision) зовут одну и ту же функцию — требование
 * роадмапа «честный CPU-мешер». Сюда же этап 4 добавит процедурные октавы
 * (слагаемое в heightMeters), сигнатуры не изменятся.
 *
 * Конвенции канонические: тексель i центрован на (i+0.5)/N (как texture2D и
 * slope-энкодер), dirToUv побайтно совпадает с развёрткой SphereGeometry —
 * закреплено паритетным тестом, не выводом.
 */
class TerrainHeightField {
  private readonly uvScratch = new Vector2()

  public constructor(
    private readonly map: HeightMapData,
    public readonly radiusKm: number
  ) {}

  public get minMeters(): number {
    return this.map.minMeters
  }

  public get maxMeters(): number {
    return this.map.maxMeters
  }

  /**
   * Развёртка SphereGeometry: x = −cos(φ)·sinθ, y = cosθ, z = sin(φ)·sinθ,
   * u = φ/2π, v карты = θ/π (0 = север; у самой геометрии uv.y = 1 − v).
   * dir должен быть нормализован.
   */
  public dirToUv(dir: Vector3, out: Vector2): Vector2 {
    let phi = Math.atan2(dir.z, -dir.x)
    if (phi < 0) phi += TWO_PI

    out.x = phi / TWO_PI
    out.y = Math.acos(Math.min(Math.max(dir.y, -1), 1)) / Math.PI

    return out
  }

  /** Билинейка на полутекселях: wrap долготы (шов меридиана), кламп широты (полюса). */
  public sampleMeters(u: number, v: number): number {
    const { width, height, minMeters, maxMeters, data } = this.map

    let x = (u - Math.floor(u)) * width - 0.5
    if (x < 0) x += width
    const x0 = Math.floor(x)
    const x1 = (x0 + 1) % width
    const fx = x - x0

    const y = Math.min(Math.max(Math.min(Math.max(v, 0), 1) * height - 0.5, 0), height - 1)
    const y0 = Math.floor(y)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = y - y0

    const h00 = data[y0 * width + x0]
    const h10 = data[y0 * width + x1]
    const h01 = data[y1 * width + x0]
    const h11 = data[y1 * width + x1]

    const raw = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy

    return minMeters + (raw / 65535) * (maxMeters - minMeters)
  }

  public heightMeters(dir: Vector3): number {
    const uv = this.dirToUv(dir, this.uvScratch)

    return this.sampleMeters(uv.x, uv.y)
  }

  public surfaceRadiusUnits(dir: Vector3): number {
    return toThreeJSUnits(this.radiusKm + this.heightMeters(dir) / 1000)
  }
}

/** Один экземпляр на карту: мешер и коллизия делят его, пересборка сцены не пересканирует данные. */
const cache = new WeakMap<HeightMapData, TerrainHeightField>()

function terrainHeightFieldFor(map: HeightMapData, radiusKm: number): TerrainHeightField {
  let field = cache.get(map)

  if (!field) {
    field = new TerrainHeightField(map, radiusKm)
    cache.set(map, field)
  }

  return field
}

export { TerrainHeightField, terrainHeightFieldFor }
