import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'

interface AudioPlayerProps {
  currentTrack?: ITrack
  trackIndex: number
  trackCount: number
  onPlay(index: number): void
  onNext(): void
  onPrev(): void
}

export { AudioPlayerProps }
