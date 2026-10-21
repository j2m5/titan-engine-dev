import type { CloudQuality } from '@/core/clouds/SceneCloudConfig'
/** Входной порт: ядро только читает флаги отображения. */
export interface Settings {
  readonly showMarkers: boolean
  readonly showOrbitLines: boolean
  readonly showClouds: boolean
  readonly cloudQuality: CloudQuality
}
