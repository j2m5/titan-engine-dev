import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AudioPlayer from '@/ui/components/common/audio/AudioPlayer'
import { audioPlayerStore } from '@/ui/mobx/AudioPlayerStore'

let container: HTMLDivElement
let root: Root
let playing: Set<HTMLMediaElement>

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  playing = new Set()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    playing.add(this)
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this)
    this.dispatchEvent(new Event('pause'))
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderTrack(src = '/first.mp3'): HTMLAudioElement {
  act(() => root.render(
    <AudioPlayer currentTrack={{ title: src, src }} trackIndex={0} trackCount={1}
      onPlay={() => {}} onNext={() => {}} onPrev={() => {}} />
  ))
  return container.querySelector('audio')!
}

async function autoplay(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
}

describe('AudioPlayer playback lifecycle', () => {
  it('waits for playback to start before showing Pause after a manual request', async () => {
    let start!: () => void
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (this: HTMLMediaElement) {
      return new Promise<void>(resolve => {
        start = () => {
          playing.add(this)
          this.dispatchEvent(new Event('playing'))
          resolve()
        }
      })
    })
    const audio = renderTrack()
    act(() => audio.dispatchEvent(new Event('canplay')))
    act(() => container.querySelector<HTMLButtonElement>('button[title="Play"]')!.click())
    expect(container.querySelector('button[title="Pause"]')).toBeNull()
    await act(async () => { start() })
    expect(container.querySelector('button[title="Pause"]')).not.toBeNull()
  })

  it('keeps the Play button usable when manual playback is rejected', async () => {
    const audio = renderTrack()
    // A plain boundary stub preserves native unhandled-rejection behavior; spies
    // observe returned promises themselves and can hide an ignored rejection.
    Object.defineProperty(audio, 'play', { value: () => Promise.reject(new Error('Playback blocked')) })
    act(() => audio.dispatchEvent(new Event('canplay')))
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="Play"]')!.click())
    expect(container.querySelector('button[title="Pause"]')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('button[title="Play"]')?.disabled).toBe(false)
  })

  it('handles rejected autoplay without preventing a later manual start', async () => {
    const audio = renderTrack()
    Object.defineProperty(audio, 'play', {
      configurable: true,
      value: () => Promise.reject(new Error('Playback blocked'))
    })
    await autoplay()
    delete (audio as Partial<HTMLAudioElement>).play
    act(() => audio.dispatchEvent(new Event('canplay')))
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="Play"]')!.click())
    expect(container.querySelector('button[title="Pause"]')).not.toBeNull()
  })

  it('stops playback when the player is removed', async () => {
    const audio = renderTrack()
    await autoplay()
    expect(playing.has(audio)).toBe(true)
    act(() => root.render(null))
    expect(playing.has(audio)).toBe(false)
  })

  it('stops the previous source and resets readiness when its replacement has the same index', async () => {
    const previous = renderTrack()
    act(() => previous.dispatchEvent(new Event('canplay')))
    await autoplay()
    const next = renderTrack('/replacement.ogg')
    expect(playing.has(previous)).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('button[title="Play"]')?.disabled).toBe(true)
    await autoplay()
    expect(playing.has(next)).toBe(true)
  })

  it('ignores a rejected playback request belonging to a previous source', async () => {
    let rejectPrevious!: (reason: Error) => void
    const previous = renderTrack()
    Object.defineProperty(previous, 'play', {
      value: () => new Promise<void>((_, reject) => { rejectPrevious = reject })
    })
    await autoplay()
    renderTrack('/replacement.ogg')
    await autoplay()
    await act(async () => { rejectPrevious(new Error('Old request aborted')) })
    expect(container.querySelector('button[title="Pause"]')).not.toBeNull()
  })

  it('ignores an empty file selection without changing the playlist', async () => {
    renderTrack()
    const originalTracks = [...audioPlayerStore.tracks]
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(audioPlayerStore.tracks).toEqual(originalTracks)
  })
})
