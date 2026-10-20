import { makeAutoObservable, runInAction } from 'mobx'
import type { IAudioMetadata } from 'music-metadata'
import AHiddenHome from '@/ui/components/common/audio/tracks/Star Citizen Soundtrack - A Hidden Home (Pedro Macedo Camacho).mp3'
import StarMap from '@/ui/components/common/audio/tracks/StarMap.ogg'
import { ITrack } from '@/ui/types'
import { notificationStore } from '@/ui/mobx/NotificationStore'

const defaultTracks: ITrack[] = [
  {
    title: 'A Hidden Home',
    src: AHiddenHome
  },
  {
    title: 'StarMap.ogg',
    src: StarMap
  }
]

class AudioPlayerStore {
  public tracks: ITrack[] = []
  private metadataPromise: Promise<void> | undefined

  public constructor(tracks: ITrack[]) {
    this.tracks = tracks
    makeAutoObservable<this, 'metadataPromise'>(this, { metadataPromise: false })
  }

  public async add(payload: ITrack): Promise<void> {
    const trackWithMetadata: ITrack = await this.fetchMetadata(payload)
    runInAction((): void => {
      this.tracks.push(trackWithMetadata)
    })
  }

  public remove(payload: number): void {
    runInAction((): void => {
      this.tracks.splice(payload, 1)
    })
  }

  public ensureMetadata(): Promise<void> {
    this.metadataPromise ??= this.initMetadata()
    return this.metadataPromise
  }

  private async initMetadata(): Promise<void> {
    await Promise.all(this.tracks.map(async (track: ITrack): Promise<void> => {
      const enriched = await this.fetchMetadata(track)
      runInAction((): void => {
        // The list can change while metadata is loading. Keep surviving track
        // identities (including the selected track), removals and uploads intact.
        if (this.tracks.includes(track) && enriched.metadata) track.metadata = enriched.metadata
      })
    }))
  }

  private async fetchMetadata(track: ITrack): Promise<ITrack> {
    try {
      const response: Response = await fetch(track.src)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob: Blob = await response.blob()
      const { parseBlob } = await import('music-metadata')
      const metadata: IAudioMetadata = await parseBlob(blob)
      return {
        ...track,
        metadata: {
          title: metadata.common.title || track.title,
          artist: metadata.common.artist || 'Unknown artist',
          album: metadata.common.album || 'Unknown album'
        }
      }
    } catch (error) {
      notificationStore.dispatch({ type: 'error', message: `Failed to load metadata: ${error}` })

      return track
    }
  }
}

export const audioPlayerStore: AudioPlayerStore = new AudioPlayerStore(defaultTracks)
