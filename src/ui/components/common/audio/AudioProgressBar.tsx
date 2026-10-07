import { ChangeEvent, FC } from 'react'
import TitanLabel from '@titanui/components/TitanLabel'
import TitanSlider from '@titanui/components/TitanSlider'
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

  // Таймеры одной ширины: слайдер между ними не ездит, пока идут секунды
  const timerStyle = { minWidth: '3.5em', textAlign: 'center', fontVariantNumeric: 'tabular-nums' } as const

  return (
    <>
      <span style={timerStyle}>
        <TitanLabel>{elapsedDisplay}</TitanLabel>
      </span>
      <TitanSlider
        value={currentProgress}
        buffer={buffered}
        step={1}
        min={0}
        max={duration}
        style={{ width: '70%' }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => handleCurrentProgress(event.target.valueAsNumber)}
      />
      <span style={timerStyle}>
        <TitanLabel>{durationDisplay}</TitanLabel>
      </span>
    </>
  )
}

export default AudioProgressBar
