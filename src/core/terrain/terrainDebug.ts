import type { TerrainPatchStats } from '@/core/terrain/TerrainPatchGroup'

/** Что реестру нужно от группы (тип, а не класс: без цикла импортов). */
export interface TerrainDebugSource {
  readonly name: string
  readonly debugKind: 'terrain' | 'water'
  stats(): TerrainPatchStats
  resetPeak(): void
}

export type TerrainDebugRow = { body: string; kind: 'terrain' | 'water' } & TerrainPatchStats

interface TerrainDebugHandle {
  /** Сводка пула по всем живым группам */
  stats(): TerrainDebugRow[]
  /** Сбросить пик живых патчей у всех групп (перед спуском) */
  resetPeak(): void
  /** console.table сводки: память в МиБ */
  table(): void
}

declare global {
  interface Window {
    __titanTerrain?: TerrainDebugHandle
  }
}

const groups = new Set<TerrainDebugSource>()

export const registerTerrainGroup = (group: TerrainDebugSource): void => {
  groups.add(group)
}

export const unregisterTerrainGroup = (group: TerrainDebugSource): void => {
  groups.delete(group)
}

export const registeredTerrainGroups = (): ReadonlySet<TerrainDebugSource> => groups

const MIB = 1024 * 1024

const collectStats = (): TerrainDebugRow[] =>
  [...groups].map((group) => ({
    body: group.name || group.constructor.name,
    kind: group.debugKind,
    ...group.stats()
  }))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__titanTerrain = {
    stats: collectStats,
    resetPeak() {
      for (const group of groups) group.resetPeak()
    },
    table() {
      console.table(
        collectStats().map(({ bytesPerSlot, liveBytes, peakBytes, heapBytesPerSlot, heapBytes, ...rest }) => ({
          ...rest,
          bytesPerSlotKiB: Math.round(bytesPerSlot / 1024),
          liveMiB: +(liveBytes / MIB).toFixed(1),
          peakMiB: +(peakBytes / MIB).toFixed(1),
          heapBytesPerSlotKiB: Math.round(heapBytesPerSlot / 1024),
          heapMiB: +(heapBytes / MIB).toFixed(1)
        }))
      )
    }
  }
}
