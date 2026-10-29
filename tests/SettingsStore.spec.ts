import { describe, it, expect, beforeEach } from 'vitest'
import { settingsStore } from '@/ui/mobx/SettingsStore'

describe('SettingsStore', () => {
  it('defaults clouds to enabled and medium; validates quality without changing unrelated settings', () => {
    expect(settingsStore.showClouds).toBe(true)
    expect(settingsStore.cloudQuality).toBe('medium')
    for (const quality of ['low', 'high', 'medium'] as const) {
      settingsStore.setCloudQuality(quality)
      expect(settingsStore.cloudQuality).toBe(quality)
    }
    expect(() => settingsStore.setCloudQuality('invalid' as never)).toThrow(RangeError)
    expect(settingsStore.cloudQuality).toBe('medium')
    settingsStore.toggle('showClouds')
    expect(settingsStore.showClouds).toBe(false)
    settingsStore.toggle('showClouds')
  })
  beforeEach(() => {
    settingsStore.showOrbitLines = true
    settingsStore.showMarkers = true
  })

  it('по умолчанию включает орбитальные линии и маркеры', () => {
    expect(settingsStore.showOrbitLines).toBe(true)
    expect(settingsStore.showMarkers).toBe(true)
  })

  it('toggle переключает только указанное поле', () => {
    settingsStore.toggle('showOrbitLines')
    expect(settingsStore.showOrbitLines).toBe(false)
    expect(settingsStore.showMarkers).toBe(true)
  })

  it('повторный toggle возвращает поле в исходное состояние', () => {
    settingsStore.toggle('showMarkers')
    settingsStore.toggle('showMarkers')
    expect(settingsStore.showMarkers).toBe(true)
  })
})
