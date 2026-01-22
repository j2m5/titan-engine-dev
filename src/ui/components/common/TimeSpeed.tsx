import { useRef } from 'react'
import { observer } from 'mobx-react-lite'
import TitanFlex from '@/ui/TitanUI/components/TitanFlex'
import TitanIconButton from '@/ui/TitanUI/components/TitanIconButton'
import {
  ArrowsClockwiseIcon,
  CaretDoubleUpIcon,
  CaretUpIcon,
  ClockClockwiseIcon,
  FastForwardIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon
} from '@phosphor-icons/react'
import { timeStore } from '@/ui/mobx/TimeStore'

const icon = (speed: number) => {
  if (speed < 100000) return <CaretUpIcon size={20} />

  return <CaretDoubleUpIcon size={20} />
}

const TimeSpeed = observer(() => {
  const previousSpeed = useRef<number>(timeStore.speedOfTime)

  const handleStopContinue = () => {
    if (timeStore.speedOfTime > 0) {
      previousSpeed.current = timeStore.speedOfTime
      timeStore.setSpeedOfTime(0)
    } else {
      timeStore.setSpeedOfTime(previousSpeed.current)
    }
  }

  const handleResetTime = () => {
    timeStore.setSpeedOfTime(1)
    timeStore.setToDefaults()
  }

  return (
    <div>
      <TitanFlex justify="center" align="center" width="inherit" style={{ gap: '5px' }}>
        <span style={{ width: '110px' }}>{timeStore.currentDate}</span>
        <TitanIconButton onClick={() => timeStore.setSpeedOfTime(1)}>
          <ArrowsClockwiseIcon size={22} />
        </TitanIconButton>
        <TitanIconButton
          disabled={timeStore.speedOfTime === timeStore.timeSteps[0]}
          onClick={() => timeStore.setSpeedBackward()}
        >
          <RewindIcon size={24} />
        </TitanIconButton>
        <TitanIconButton onClick={handleStopContinue}>
          {timeStore.speedOfTime === 0 ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </TitanIconButton>
        <TitanIconButton
          disabled={timeStore.speedOfTime === timeStore.timeSteps[timeStore.timeSteps.length - 1]}
          onClick={() => timeStore.setSpeedForward()}
        >
          <FastForwardIcon size={24} />
        </TitanIconButton>
        <TitanIconButton onClick={handleResetTime}>
          <ClockClockwiseIcon size={22} />
        </TitanIconButton>
        <span style={{ width: '75px' }}>{timeStore.currentTime}</span>
        <TitanFlex width={125}>
          {icon(timeStore.speedOfTime)}
          <span style={{ marginLeft: '5px' }}>{timeStore.speedOfTime}x</span>
        </TitanFlex>
      </TitanFlex>
    </div>
  )
})

export default TimeSpeed
