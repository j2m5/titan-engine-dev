import { BooleanSettingKey } from '@/ui/mobx/SettingsStore'

export interface ToggleSetting {
  key: BooleanSettingKey
  label: string
  group: string
}

export const toggleSettings: ToggleSetting[] = [
  { key: 'showOrbitLines', label: 'Orbital lines', group: 'Display' },
  { key: 'showMarkers', label: 'Object markers', group: 'Display' }
]
