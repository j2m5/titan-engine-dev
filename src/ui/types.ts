export type { SystemNotification } from '@/core/ports/NotificationSink'

export type SaveFunction = (value: string) => void

export type TrackMetadata = {
  title: string
  artist: string
  album: string
}

export interface ITrack {
  title: string
  src: string
  metadata?: TrackMetadata
}

export interface TrackListProps {
  data: ITrack[]
  currentTrackIndex: number
  isPlaying: boolean
  onPlay(index: number): void
  onTogglePlaying(): void
}

export interface AudioProgressBarProps {
  duration: number
  currentProgress: number
  buffered: number
  onProgressChanged(value: number): void
}

export interface AudioPlayerProps {
  currentTrack?: ITrack
  trackIndex: number
  trackCount: number
  onPlay(index: number): void
  onNext(): void
  onPrev(): void
}
