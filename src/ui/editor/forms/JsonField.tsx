import { FC, useEffect, useState } from 'react'
import TitanTextarea from '@titanui/components/TitanTextarea'
import TitanSelect from '@titanui/components/TitanSelect'
import { TitanSelectOption } from '@titanui/types'

export interface JsonFieldProps {
  label: string
  /** текущее значение (объект) */
  value: unknown
  /** варианты для клонирования: [подпись, объект-data] */
  cloneOptions?: Array<{ label: string; value: string; data: unknown }>
  rows?: number
  onChange(value: unknown): void
}

const JsonField: FC<JsonFieldProps> = ({ label, value, cloneOptions, rows = 10, onChange }) => {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cloneId, setCloneId] = useState('')

  // синхронизация при смене записи извне: показываем форматированный JSON
  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2))
    setError(null)
  }, [value])

  const handleText = (next: string): void => {
    setText(next)
    try {
      const parsed = JSON.parse(next)
      setError(null)
      onChange(parsed)
    } catch (e) {
      // не поднимаем наверх битый JSON — держим последнее валидное значение,
      // показываем ошибку парсинга, save заблокируется при пустой/битой data
      setError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  const handleClone = (id: string): void => {
    setCloneId(id)
    const opt = cloneOptions?.find((o) => o.value === id)
    if (!opt) return
    const formatted = JSON.stringify(opt.data ?? {}, null, 2)
    setText(formatted)
    setError(null)
    onChange(opt.data)
  }

  const selectOptions: TitanSelectOption[] = (cloneOptions ?? []).map((o) => ({
    value: o.value,
    label: o.label
  }))

  return (
    <div className="titan-field" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="titan-field-label">{label}</span>
        {cloneOptions && cloneOptions.length > 0 && (
          <div style={{ minWidth: '220px' }}>
            <TitanSelect value={cloneId} placeholder="— clone from… —" options={selectOptions} onChange={handleClone} />
          </div>
        )}
      </div>

      <TitanTextarea label="" value={text} rows={rows} invalid={error !== null} onChange={handleText} />

      {error && <span style={{ color: '#e74c3c', fontSize: '12px' }}>JSON error: {error}</span>}
    </div>
  )
}

export default JsonField
