import { FC } from 'react'
import { AudioProgressBarProps } from '@/ui/components/modules/audio/interfaces/AudioProgressBarProps'
import { Stack, Slider, Typography } from '@mui/material'

const formatDurationDisplay = (duration: number) => {
  const min: number = Math.floor(duration / 60)
  const sec: number = Math.floor(duration - min * 60)

  return [min, sec].map((n: number): string | number => (n < 10 ? '0' + n : n)).join(':')
}

const AudioProgressBar: FC<AudioProgressBarProps> = (props: AudioProgressBarProps) => {
  const { duration, currentProgress, buffered, onProgressChanged } = props

  const durationDisplay: string = formatDurationDisplay(duration)
  const elapsedDisplay: string = formatDurationDisplay(currentProgress)

  const handleCurrentProgress = (value: number): void => {
    onProgressChanged(value)
  }

  return (
    <Stack spacing={2} direction="row" alignItems="center">
      <Typography variant="caption">{elapsedDisplay}</Typography>
      <Slider
        sx={{
          position: 'relative',
          '& .MuiSlider-track': {
            zIndex: 2
          },
          '& .MuiSlider-thumb': {
            zIndex: 3
          },
          '&:before': {
            content: '""',
            borderRadius: 'inherit',
            position: 'absolute',
            height: 'inherit',
            width: `${(buffered / duration) * 100}%`,
            backgroundColor: '#78909c',
            zIndex: 1
          }
        }}
        size="medium"
        value={currentProgress}
        step={1}
        min={0}
        max={duration}
        onChange={(event, value) => handleCurrentProgress(Number(value))}
      />
      <Typography variant="caption">{durationDisplay}</Typography>
    </Stack>
  )
}

export default AudioProgressBar
