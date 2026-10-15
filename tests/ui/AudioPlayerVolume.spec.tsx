import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AudioPlayer from '@/ui/components/common/audio/AudioPlayer'

// Metadata fetching is unrelated to playback volume and requires network/audio parsing.
vi.mock('@/ui/mobx/AudioPlayerStore', () => ({ audioPlayerStore: { tracks: [] } }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  sessionStorage.clear()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

function mountPlayer(): HTMLAudioElement {
  act(() => root.render(
    <AudioPlayer currentTrack={{ title: 'Track', src: '/track.mp3' }} trackIndex={0} trackCount={1}
      onPlay={() => {}} onNext={() => {}} onPrev={() => {}} />
  ))
  const audio = container.querySelector('audio')!
  act(() => audio.dispatchEvent(new Event('canplay')))

  return audio
}

describe('AudioPlayer cached volume', () => {
  it('keeps mute after the player is unmounted and mounted again', () => {
    mountPlayer()
    const mute = container.querySelector<HTMLButtonElement>('button[title="Mute"]')!
    act(() => mute.click())
    expect(sessionStorage.getItem('volume')).toBe('0')
    act(() => root.render(null))
    expect(mountPlayer().volume).toBe(0)
  })

  it.each([
    [null, 0.1], ['', 0.1], ['  ', 0.1], ['bad', 0.1], ['NaN', 0.1],
    ['Infinity', 0.1], ['-Infinity', 0.1], ['-0.5', 0], ['1.5', 1], ['0.45', 0.45], ['1', 1]
  ])('restores %s as safe audio volume %s', (cached, expected) => {
    if (cached !== null) sessionStorage.setItem('volume', cached)
    const audio = mountPlayer()
    expect(audio.volume).toBe(expected)
    expect(container.querySelector<HTMLInputElement>('input[type="range"][max="1"]')!.valueAsNumber).toBe(expected)
  })
})
