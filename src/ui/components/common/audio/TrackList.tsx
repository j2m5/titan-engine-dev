import { FC } from 'react'
import TitanSimpleList from '@titanui/components/TitanSimpleList'
import TitanListItem from '@titanui/components/TitanListItem'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanIconButton from '@titanui/components/TitanIconButton'
import TitanLabel from '@titanui/components/TitanLabel'
import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { ITrack } from '@/ui/types'
import { TrackListProps } from '@/ui/types'

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
