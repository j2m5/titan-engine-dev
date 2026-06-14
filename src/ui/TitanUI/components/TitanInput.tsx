import { FC } from 'react'
import { TitanInputProps } from '@titanui/types'

const TitanInput: FC<TitanInputProps> = ({
  type = 'text',
  value,
  label,
  placeholder,
  invalid = false,
  disabled = false,
  min,
  max,
  step,
  style = {},
  onChange
}) => {
  const isColor = type === 'color'

  return (
    <label className={`titan-field ${invalid ? 'invalid' : ''}`} style={style}>
      {label && <span className="titan-field-label">{label}</span>}
      <input
        className={`titan-input ${isColor ? 'titan-input-color' : ''}`}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export default TitanInput
