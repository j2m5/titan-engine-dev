import { BooleanSettingKey } from '@/ui/mobx/SettingsStore'

export interface ToggleSetting {
  key: BooleanSettingKey
  label: string
  group: string
}

export const toggleSettings: ToggleSetting[] = [
  { key: 'showOrbitLines', label: 'Orbital lines', group: 'Display' },
  { key: 'showMarkers', label: 'Object markers', group: 'Display' },
  { key: 'showClouds', label: 'Облака', group: 'Display' }
]

export const cloudQualitySetting = {
  label: 'Качество облаков',
  group: 'Display',
  options: [
    { value: 'low', label: 'Низкое' },
    { value: 'medium', label: 'Среднее' },
    { value: 'high', label: 'Высокое' }
  ]
}
