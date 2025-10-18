import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'

interface TrackListProps {
  data: ITrack[]
  currentTrackIndex: number
  isPlaying: boolean
  onPlay(index: number): void
  onTogglePlaying(): void
}

export { TrackListProps }
