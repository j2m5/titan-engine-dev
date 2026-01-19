import { FC } from 'react'
import { TrackListProps } from '@/ui/components/modules/audio/interfaces/TrackListProps'
import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'
import TitanSimpleList from '@/ui/TitanUI/components/TitanSimpleList'
import TitanListItem from '@/ui/TitanUI/components/TitanListItem'
import TitanFlex from '@/ui/TitanUI/components/TitanFlex'
import TitanIconButton from '@/ui/TitanUI/components/TitanIconButton'
import TitanLabel from '@/ui/TitanUI/components/TitanLabel'
import { PauseIcon, PlayIcon } from '@phosphor-icons/react'

const TrackList: FC<TrackListProps> = (props: TrackListProps) => {
  const { data, isPlaying, currentTrackIndex, onPlay, onTogglePlaying } = props

  const handleClick = (index: number): void => {
    if (currentTrackIndex === index) {
      handleToggle()
    } else {
      handlePlay(index)
    }
  }

  const handlePlay = (index: number): void => {
    onPlay(index)
  }

  const handleToggle = (): void => {
    onTogglePlaying()
  }

  return (
    <TitanSimpleList style={{ maxHeight: '485px' }}>
      {data.map((item: ITrack, index: number) => (
        <TitanListItem key={index} style={{ padding: '2px', background: 'none' }}>
          <TitanFlex align="center" style={{ gap: '10px' }}>
            <TitanIconButton onClick={() => handleClick(index)}>
              {isPlaying && currentTrackIndex === index ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            </TitanIconButton>
            <div style={{ width: '100%' }}>
              <TitanLabel>{`${item.metadata?.title ?? item.title} - ${item.metadata?.artist}`}</TitanLabel>
            </div>
          </TitanFlex>
        </TitanListItem>
      ))}
    </TitanSimpleList>
  )
}

export default TrackList
