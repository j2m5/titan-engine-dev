import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackLabel } from '@/ui/components/common/audio/trackHelpers'
import { audioBlob } from '../helpers/audioBlob'

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => audioBlob() }))
})
afterEach(() => vi.unstubAllGlobals())

async function store() {
  return (await import('@/ui/mobx/AudioPlayerStore')).audioPlayerStore
}

describe('optional audio metadata', () => {
  it('exposes playable defaults without fetching or parsing at import/construction', async () => {
    const audio = await store()
    expect(audio.tracks.map(trackLabel)).toEqual(['A Hidden Home', 'StarMap.ogg'])
    expect(audio.tracks.every(track => track.src.length > 0)).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loads only on demand and deduplicates overlapping and later demand', async () => {
    const audio = await store()
    await Promise.all([audio.ensureMetadata(), audio.ensureMetadata()])
    await audio.ensureMetadata()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await import('@/ui/mobx/NotificationStore')).notificationStore.notifications).toEqual([])
    expect(audio.tracks.map(trackLabel)).toEqual(['Metadata title - Unknown artist', 'Metadata title - Unknown artist'])
  })

  it('enriches surviving identities without resurrecting removals or losing uploads', async () => {
    const audio = await store()
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    vi.mocked(fetch).mockImplementation(async src => {
      if (!String(src).startsWith('blob:')) await pending
      return { ok: true, blob: async () => audioBlob() } as Response
    })
    const metadata = audio.ensureMetadata()
    const survivor = audio.tracks[1]
    audio.remove(0)
    await audio.add({ title: 'Upload', src: 'blob:upload' })
    finish()
    await metadata
    expect(audio.tracks).toHaveLength(2)
    expect(audio.tracks[0]).toBe(survivor)
    expect(audio.tracks[1].src).toBe('blob:upload')
    expect(audio.tracks.map(trackLabel)).toEqual(['Metadata title - Unknown artist', 'Metadata title - Unknown artist'])
  })

  it.each(['network', 'http', 'parser'])('keeps playable fallback after %s failure and reports it', async failure => {
    const audio = await store()
    if (failure === 'network') vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    if (failure === 'http') vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)
    if (failure === 'parser') vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response)
    await audio.ensureMetadata()
    await audio.ensureMetadata()
    expect(audio.tracks.map(trackLabel)).toEqual(['A Hidden Home', 'StarMap.ogg'])
    expect(audio.tracks.every(track => track.src.length > 0)).toBe(true)
    const { notificationStore } = await import('@/ui/mobx/NotificationStore')
    expect(notificationStore.notifications).toHaveLength(2)
    expect(notificationStore.notifications.every(item => item.type === 'error')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
