import { FC } from 'react'
import { TitanSliderProps } from '@titanui/types'
import { sliderFill } from '@titanui/utils/helpers'

const TitanSlider: FC<TitanSliderProps> = ({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  buffer = 0,
  disabled = false,
  style = {},
  onChange
}) => {
  const { percent, bufferPercent } = sliderFill(value, min, max, buffer)

  return (
    <input
      className="titan-slider"
      style={{
        ...style,
        background: `linear-gradient(
          to right,
          #222222 0%,
          #222222 ${percent}%,
          #888888 ${percent}%,
          #888888 ${bufferPercent}%,
          #444444 ${bufferPercent}%,
          #444444 100%
        )`
      }}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

export default TitanSlider
