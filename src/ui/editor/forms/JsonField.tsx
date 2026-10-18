import { FC, useEffect, useState } from 'react'
import TitanTextarea from '@titanui/components/TitanTextarea'
import TitanSelect from '@titanui/components/TitanSelect'
import { TitanSelectOption } from '@titanui/types'
import { DataTemplate } from '@/ui/editor/forms/dataTemplates'

export interface JsonInputState {
  text: string
  error: string | null
  /** Rendering controls apply only while the row's actor has this category. */
  category?: string
}

export interface JsonFieldProps {
  label: string
  /** текущее значение (объект) */
  value: unknown
  /** варианты для клонирования: [подпись, объект-data] */
  cloneOptions?: Array<{ label: string; value: string; data: unknown }>
  /** заготовки data по категориям */
  templates?: DataTemplate[]
  rows?: number
  inputState?: JsonInputState
  onInputChange?(state: JsonInputState): void
  onChange(value: unknown): void
}

/** Текст уже описывает это значение — с точностью до пробелов и переносов */
function describesValue(text: string, value: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value ?? {})
  } catch {
    return false
  }
}

const JsonField: FC<JsonFieldProps> = ({ label, value, cloneOptions, templates, rows = 10, inputState, onInputChange, onChange }) => {
  const [localInput, setLocalInput] = useState<JsonInputState>(() => ({
    text: JSON.stringify(value ?? {}, null, 2), error: null
  }))
  const { text, error } = onInputChange
    ? inputState ?? { text: JSON.stringify(value ?? {}, null, 2), error: null }
    : localInput
  const [cloneId, setCloneId] = useState('')
  const [templateId, setTemplateId] = useState('')

  // Синхронизация при смене записи извне: показываем форматированный JSON.
  // Своё же значение, вернувшееся пропом после ввода, текст не трогает —
  // иначе каждое валидное нажатие переформатировало поле и курсор прыгал в конец
  useEffect(() => {
    if (onInputChange) return
    setLocalInput((current) => ({
      text: describesValue(current.text, value) ? current.text : JSON.stringify(value ?? {}, null, 2),
      error: null
    }))
  }, [value, onInputChange])

  const updateInput = (state: JsonInputState): void => {
    if (onInputChange) onInputChange(state)
    else setLocalInput(state)
  }

  const handleText = (next: string): void => {
    try {
      const parsed = JSON.parse(next)
      updateInput({ text: next, error: null })
      onChange(parsed)
    } catch (e) {
      updateInput({ text: next, error: e instanceof Error ? e.message : 'Invalid JSON' })
    }
  }

  /** общая подстановка блока data: и клон записи, и заготовка категории */
  const applyData = (data: unknown): void => {
    updateInput({ text: JSON.stringify(data ?? {}, null, 2), error: null })
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
      <div className="json-field-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span className="titan-field-label">{label}</span>
        <div className="json-field-actions" style={{ display: 'flex', gap: '8px' }}>
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
