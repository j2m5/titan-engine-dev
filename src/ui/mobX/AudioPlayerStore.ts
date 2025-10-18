import StarMap from '@/ui/components/modules/audio/tracks/StarMap.ogg'
import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack.ts'
import { makeAutoObservable, runInAction } from 'mobx'
import { IAudioMetadata, parseBlob } from 'music-metadata-browser'
import { notificationStore } from '@/ui/mobX/NotificationStore.ts'

const defaultTracks: ITrack[] = [
  {
    title: 'StarMap.ogg',
    src: StarMap
  }
]

class AudioPlayerStore {
  public tracks: ITrack[] = []

  public constructor(tracks: ITrack[]) {
    makeAutoObservable(this)
    this.initTracks(tracks)
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

  private async initTracks(tracks: ITrack[]): Promise<void> {
    const tracksWithMetadata: ITrack[] = await Promise.all(tracks.map((track: ITrack) => this.fetchMetadata(track)))
    runInAction((): void => {
      this.tracks = tracksWithMetadata
    })
  }

  private async fetchMetadata(track: ITrack): Promise<ITrack> {
    try {
      const response: Response = await fetch(track.src)
      const blob: Blob = await response.blob()
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
      notificationStore.openNotification({ type: 'error', message: `Failed to load metadata: ${error}` })

      return track
    }
  }
}

export const audioPlayerStore: AudioPlayerStore = new AudioPlayerStore(defaultTracks)
