import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { observable, runInAction } from 'mobx'
import { afterEach, expect, it, vi } from 'vitest'
import App from '@/ui/App'
import { engineStore } from '@/ui/mobx/EngineStore'
import { modalWindowStore } from '@/ui/mobx/ModalWindowStore'
import { audioPlayerStore } from '@/ui/mobx/AudioPlayerStore'
import { audioBlob } from '../helpers/audioBlob'

// The engine and unrelated panels require a WebGL simulation, outside this UI boundary.
vi.mock('@/ui/mobx/EngineStore', () => ({ engineStore: observable({ scenario: null, appLoadingStatus: false }) }))
vi.mock('@/ui/components/layout/HomePage', () => ({ default: () => null }))
vi.mock('@/ui/components/layout/LoadingScreen', () => ({ default: () => null }))
vi.mock('@/ui/components/layout/MainAppBar', () => ({ default: () => null }))
vi.mock('@/ui/components/common/ObjectList', () => ({ default: () => null }))
vi.mock('@/ui/components/common/bodyInfo/BodyInfoPanel', () => ({ default: () => null }))
vi.mock('@/ui/components/common/CameraSpeed', () => ({ default: () => null }))
vi.mock('@/ui/components/common/SettingsContent', () => ({ default: () => null }))
vi.mock('@/ui/components/common/TutorialContent', () => ({ default: () => null }))
vi.mock('@/ui/components/common/NotificationMessage', () => ({ default: () => null }))

afterEach(() => vi.unstubAllGlobals())

it('defers metadata through home/loading/hidden player until the audio window is visible', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let finishMetadata!: () => void
  const pending = new Promise<void>(resolve => { finishMetadata = resolve })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    await pending
    return { ok: true, blob: async () => audioBlob() }
  }))
  const originalTracks = [...audioPlayerStore.tracks]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    act(() => modalWindowStore.setAudioPlayerWindowState(true))
    act(() => root.render(<App />))
    expect(fetch).not.toHaveBeenCalled()
    act(() => runInAction(() => {
      engineStore.scenario = {} as typeof engineStore.scenario
      engineStore.appLoadingStatus = true
    }))
    expect(fetch).not.toHaveBeenCalled()
    act(() => modalWindowStore.setAudioPlayerWindowState(false))
    act(() => runInAction(() => { engineStore.appLoadingStatus = false }))
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => {
      modalWindowStore.setAudioPlayerWindowState(true)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('A Hidden Home')
    expect(document.body.textContent).toContain('StarMap.ogg')
    expect(document.querySelector('audio')).toBeNull()
    // Resolve metadata without selecting a track or rendering the parent again.
    await act(async () => {
      finishMetadata()
      await audioPlayerStore.ensureMetadata()
    })
    expect(document.body.textContent?.match(/Metadata title - Unknown artist/g) ?? []).toHaveLength(2)
    expect(document.querySelector('audio')).toBeNull()
    expect(audioPlayerStore.tracks[0]).toBe(originalTracks[0])
    expect(audioPlayerStore.tracks[1]).toBe(originalTracks[1])
    act(() => modalWindowStore.setAudioPlayerWindowState(false))
    act(() => modalWindowStore.setAudioPlayerWindowState(true))
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally {
    act(() => root.unmount())
    container.remove()
    act(() => modalWindowStore.setAudioPlayerWindowState(false))
  }
})
