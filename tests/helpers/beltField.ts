import { PerspectiveCamera, Vector3, type InstancedMesh } from 'three'
import { toAstronomicalUnits } from '@/core/helpers/scaling'
import { AU } from '@/core/constants'
import { PIXEL_RAD } from '@/core/renderables/DetailedRingStreamingSystem/cascadeScale'
import type { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import type { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import type { UpdateContext } from '@/core/UpdateContext'

const km = (units: number): number => toAstronomicalUnits(units) * AU

/**
 * Приватные поля стримера, нужные замеру (пул инстансов, плавающее начало,
 * габарит архетипа пула), плюс публичная диагностика. Отдельный структурный
 * тип, не пересечение с классом: приватные поля с общим именем схлопывают
 * такое пересечение в never.
 */
type StreamerInternals = {
  pool: { geometryMeshes: InstancedMesh[]; nearMeshes: InstancedMesh[]; billboardMesh: InstancedMesh }
  originGroup: { position: Vector3 } | null
  config: { asteroidSizeKm: number }
  getDebugInfo(): { activeSectors: number; poolPressure: { totalFailures: number } }
}

interface BeltFieldMeasurement {
  /** Живых тел в пуле — непустые слоты всех стримов (Geometry + Near + billboard) */
  total: number
  /** Расстояние до ближайшего тела, км */
  nearestKm: number
  /** Медианное расстояние по живым телам, км */
  medianKm: number
  /** Тел ближе limit км */
  withinKm(limit: number): number
  /** Тел с угловым размером больше px пикселей при 50° на 1080 строк (см. PIXEL_RAD) */
  largerThanPx(px: number): number
  /** Радиусы (км) n ближайших тел по возрастанию расстояния — для проверки разнообразия калибров */
  nearestSizesKm(n: number): number[]
  /** Активных секторов по всем каскадам (0, если стример ещё не создан) */
  activeSectors: number
  /** Отказов аллокации пула — молчаливая потеря секторов при исчерпании (см. InstancePool) */
  poolFailures: number
}

/**
 * Замер того, что реально оказалось вокруг камеры: обход живых экземпляров
 * пула с восстановлением мировой позиции (начало группы + instanceOrigin +
 * матрица). Движок раздаёт updateObject обходом сцены (SceneManager.update →
 * scene.traverse), поэтому кадр здесь — belt.traverse, а не один вызов у узла:
 * иначе стример, созданный поясом в этом же кадре, не получит своего апдейта.
 */
export function measureBeltField(belt: AsteroidBelt, cameraWorld: Vector3, frames: number = 90): BeltFieldMeasurement {
  const camera = new PerspectiveCamera(50, 1920 / 1080, 0.1, 1e12)
  camera.position.copy(cameraWorld)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

  for (let i = 0; i < frames; i++) {
    belt.updateMatrixWorld(true)
    belt.traverse((object) =>
      object.updateObject({ delta: 0.05, epoch: 2451545, elapsed: i * 0.05, camera } as UpdateContext)
    )
  }

  const streamer = (belt as unknown as { streamer: AsteroidRingSystem | null }).streamer as StreamerInternals | null
  const bodies: { distanceKm: number; sizeKm: number }[] = []

  if (streamer) {
    const origin = streamer.originGroup ? streamer.originGroup.position : new Vector3()
    // Габарит архетипа общий на пул (см. AsteroidBelt.__createStreamer): матричный
    // масштаб — безразмерный множитель к нему, а не км сам по себе
    const asteroidSizeKm = streamer.config.asteroidSizeKm
    const meshes = [...streamer.pool.geometryMeshes, ...streamer.pool.nearMeshes, streamer.pool.billboardMesh]

    for (const mesh of meshes) {
      const m = mesh.instanceMatrix.array as Float32Array
      const origins = mesh.geometry.getAttribute('instanceOrigin')?.array as Float32Array | undefined

      for (let i = 0; i < mesh.count; i++) {
        // Масштаб инстанса — длина первого столбца матрицы (поворот длину сохраняет)
        const scale = Math.hypot(m[i * 16], m[i * 16 + 1], m[i * 16 + 2])
        // Пустой слот внутри high-water mark: масштаб нулевой
        if (scale < 1e-9) continue

        const x = origin.x + (origins ? origins[i * 3] : 0) + m[i * 16 + 12]
        const y = origin.y + (origins ? origins[i * 3 + 1] : 0) + m[i * 16 + 13]
        const z = origin.z + (origins ? origins[i * 3 + 2] : 0) + m[i * 16 + 14]

        bodies.push({
          distanceKm: km(Math.hypot(x - cameraWorld.x, y - cameraWorld.y, z - cameraWorld.z)),
          sizeKm: scale * asteroidSizeKm
        })
      }
    }
  }
  bodies.sort((a, b) => a.distanceKm - b.distanceKm)

  const debug = streamer?.getDebugInfo()

  return {
    total: bodies.length,
    nearestKm: bodies.length > 0 ? bodies[0].distanceKm : Number.POSITIVE_INFINITY,
    medianKm: bodies.length > 0 ? bodies[Math.floor(bodies.length / 2)].distanceKm : Number.POSITIVE_INFINITY,
    withinKm: (limit: number): number => bodies.filter((b) => b.distanceKm < limit).length,
    // Угловой размер в px: sizeKm/distanceKm — доля радиана, деление на PIXEL_RAD даёт пиксели
    largerThanPx: (px: number): number => bodies.filter((b) => b.sizeKm / b.distanceKm / PIXEL_RAD > px).length,
    nearestSizesKm: (n: number): number[] => bodies.slice(0, n).map((b) => b.sizeKm),
    activeSectors: debug?.activeSectors ?? 0,
    poolFailures: debug?.poolPressure.totalFailures ?? 0
  }
}
