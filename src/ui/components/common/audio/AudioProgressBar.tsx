import { ChangeEvent, FC } from 'react'
import TitanLabel from '@/ui/TitanUI/components/TitanLabel'
import TitanSlider from '@/ui/TitanUI/components/TitanSlider'
import { AudioProgressBarProps } from '@/ui/types'

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
    <>
      <TitanLabel>{elapsedDisplay}</TitanLabel>
      <TitanSlider
        value={currentProgress}
        buffer={buffered}
        step={1}
        min={0}
        max={duration}
        style={{ width: '70%' }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => handleCurrentProgress(event.target.valueAsNumber)}
      />
      <TitanLabel>{durationDisplay}</TitanLabel>
    </>
  )
}

export default AudioProgressBar
