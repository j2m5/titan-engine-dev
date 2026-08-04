import { FC, useEffect, useState } from 'react'
import TitanTextarea from '@titanui/components/TitanTextarea'
import TitanSelect from '@titanui/components/TitanSelect'
import { TitanSelectOption } from '@titanui/types'
import { DataTemplate } from '@/ui/editor/forms/dataTemplates'

export interface JsonFieldProps {
  label: string
  /** текущее значение (объект) */
  value: unknown
  /** варианты для клонирования: [подпись, объект-data] */
  cloneOptions?: Array<{ label: string; value: string; data: unknown }>
  /** заготовки data по категориям */
  templates?: DataTemplate[]
  rows?: number
  onChange(value: unknown): void
}

const JsonField: FC<JsonFieldProps> = ({ label, value, cloneOptions, templates, rows = 10, onChange }) => {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cloneId, setCloneId] = useState('')
  const [templateId, setTemplateId] = useState('')

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

  /** общая подстановка блока data: и клон записи, и заготовка категории */
  const applyData = (data: unknown): void => {
    setText(JSON.stringify(data ?? {}, null, 2))
    setError(null)
    onChange(data)
  }

  const handleClone = (id: string): void => {
    setCloneId(id)
    const opt = cloneOptions?.find((o) => o.value === id)
    if (!opt) return
    applyData(opt.data)
  }

  const handleTemplate = (id: string): void => {
    setTemplateId(id)
    const opt = templates?.find((t) => t.value === id)
    if (!opt) return
    applyData(opt.data)
  }

  const selectOptions: TitanSelectOption[] = (cloneOptions ?? []).map((o) => ({
    value: o.value,
    label: o.label
  }))

  const templateOptions: TitanSelectOption[] = (templates ?? []).map((t) => ({
    value: t.value,
    label: t.label
  }))

  return (
    <div className="titan-field" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span className="titan-field-label">{label}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {templates && templates.length > 0 && (
            <div style={{ minWidth: '180px' }}>
              <TitanSelect
                value={templateId}
                placeholder="— template… —"
                options={templateOptions}
                onChange={handleTemplate}
              />
            </div>
          )}
          {cloneOptions && cloneOptions.length > 0 && (
            <div style={{ minWidth: '220px' }}>
              <TitanSelect
                value={cloneId}
                placeholder="— clone from… —"
                options={selectOptions}
                onChange={handleClone}
              />
            </div>
          )}
        </div>
      </div>

      <TitanTextarea label="" value={text} rows={rows} invalid={error !== null} onChange={handleText} />

      {error && <span style={{ color: '#e74c3c', fontSize: '12px' }}>JSON error: {error}</span>}
    </div>
  )
}

export default JsonField
