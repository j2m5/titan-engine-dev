export interface AsteroidImpostorSettings {
  enabled: boolean
  gridSize: number
  frameSize: number
  budgetMiB: number
  loadViewsPerChunk: number
  frameViewsPerChunk: number
  chunkCpuMs: number
  detailStartFraction: number
  bakeVersion: number
}

export const asteroidImpostor: { asteroidImpostor: AsteroidImpostorSettings } = {
  asteroidImpostor: {
    enabled: true,
    gridSize: 8,
    frameSize: 64,
    budgetMiB: 192,
    loadViewsPerChunk: 8,
    frameViewsPerChunk: 2,
    chunkCpuMs: 2,
    detailStartFraction: 0.75,
    bakeVersion: 1
  }
}
