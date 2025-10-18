import { FC } from 'react'
import { List, ListItem, ListItemButton, ListItemIcon, ListItemText } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import { TrackListProps } from '@/ui/components/modules/audio/interfaces/TrackListProps'
import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'

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
    <List sx={{ width: 'inherit' }}>
      {data.map((item: ITrack, index: number) => (
        <ListItem key={index} disablePadding>
          <ListItemButton disableGutters onClick={() => handleClick(index)}>
            <ListItemIcon>{isPlaying && currentTrackIndex === index ? <PauseIcon /> : <PlayArrowIcon />}</ListItemIcon>
            <ListItemText primary={`${item.metadata?.title ?? item.title} - ${item.metadata?.artist}`} />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  )
}

export default TrackList
