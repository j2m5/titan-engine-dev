import { FC } from 'react'
import { TitanSelectProps } from '@titanui/types'

/**
 * Выпадающий список. Закрывает все enum/связи редактора:
 * parentId (с placeholder '— none —'), categoryId, resourceType, direction (1/-1),
 * colorSpace и пр. value всегда строка — вызывающий код приводит к нужному типу.
 */
const TitanSelect: FC<TitanSelectProps> = ({
  value,
  options,
  label,
  placeholder,
  invalid = false,
  disabled = false,
  style = {},
  onChange
}) => {
  return (
    <label className={`titan-field ${invalid ? 'invalid' : ''}`} style={style}>
      {label && <span className="titan-field-label">{label}</span>}
      <select
        className="titan-input titan-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default TitanSelect
