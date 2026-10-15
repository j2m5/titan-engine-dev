import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { NearTileParams } from '@/core/terrain/nearTileBake'
import { WorkerTerrainPatchBuilder } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'

/** Native Worker + production handler; controlled synthetic load without a latency threshold. */
export async function checkWorkerCancellation(): Promise<{
  syntheticField: [number, number]
  abandonedJobs: number
  abandonedTexels: number
  newTexels: number
  warmSmallMs: number
  resetToSmallMs: number
  oldCallbacks: number
  newResult: number[]
  offThread: boolean
}> {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001) % 65535
  const field = new TerrainHeightField({ width, height, minMeters: 0, maxMeters: 1000, data }, 1737.4)
  const params: NearTileParams = { center: [0, 0, 1], east: [1, 0, 0], north: [0, 1, 0], texels: 2, texelMeters: 3 }
  const builder = new WorkerTerrainPatchBuilder()
  let oldCallbacks = 0
  const request = (): Promise<Float32Array> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native terrain worker request timeout')), 20_000)
    try {
      builder.requestNearTile(field, params, (result) => {
        clearTimeout(timer)
        resolve(result)
      }, (error) => {
        clearTimeout(timer)
        reject(error)
      })
    } catch (error) {
      clearTimeout(timer)
      reject(error)
    }
  })
  try {
    await request()
    const warmStart = performance.now()
    const expected = await request()
    const warmSmallMs = performance.now() - warmStart
    for (let n = 0; n < 3; n++) {
      builder.requestNearTile(field, { ...params, texels: 1024 }, () => oldCallbacks++, () => oldCallbacks++)
    }
    const resetStart = performance.now()
    builder.releaseAll()
    const result = await request()
    const resetToSmallMs = performance.now() - resetStart
    if (oldCallbacks !== 0) throw new Error(`Abandoned terrain jobs invoked ${oldCallbacks} callbacks`)
    if (!builder.offThread) throw new Error('Native terrain worker fell back to the main thread')
    if (result.length !== expected.length || result.some((value, i) => value !== expected[i])) {
      throw new Error('Native terrain worker result changed after scenario reset')
    }
    return {
      syntheticField: [width, height], abandonedJobs: 3, abandonedTexels: 1024, newTexels: 2,
      warmSmallMs, resetToSmallMs, oldCallbacks, newResult: Array.from(result), offThread: builder.offThread
    }
  } finally {
    builder.dispose()
  }
}
