import { FC } from 'react'
import { TitanToggleProps } from '@titanui/types'

const TitanToggle: FC<TitanToggleProps> = ({ checked, label, disabled = false, onChange }) => {
  return (
    <label className={`titan-toggle ${disabled ? 'disabled' : ''}`}>
      <input
        className="titan-toggle-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="titan-toggle-track">
        <span className="titan-toggle-thumb" />
      </span>
      {label && <span className="titan-toggle-label">{label}</span>}
    </label>
  )
}

export default TitanToggle
