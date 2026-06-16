import { FC } from 'react'
import TitanInput from '@titanui/components/TitanInput'
import TitanTextarea from '@titanui/components/TitanTextarea'
import TitanSelect from '@titanui/components/TitanSelect'
import TitanButton from '@titanui/components/TitanButton'
import TitanFlex from '@titanui/components/TitanFlex'
import { TitanSelectOption } from '@titanui/types'
import { DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'
import { FieldSpec, TableSpec } from '@/ui/editor/forms/fieldSpec'
import JsonField from '@/ui/editor/forms/JsonField'
import { shortenResourcePath } from '@/ui/editor/forms/shortenResourcePath'

export interface GenericFormProps {
  spec: TableSpec
  /** редактируемая запись (или null — пустая форма) */
  row: Record<string, unknown> | null
  /** весь черновик — для построения FK-селектов */
  draft: DatabaseSnapshot
  onChange(row: Record<string, unknown>): void
  onDelete(): void
}

const GenericForm: FC<GenericFormProps> = ({ spec, row, draft, onChange, onDelete }) => {
  if (!row) {
    return <div style={{ color: '#888', padding: '20px' }}>Select a record or create a new one.</div>
  }

  const update = (key: string, value: unknown): void => {
    onChange({ ...row, [key]: value })
  }

  // строит опции FK-селекта: записи целевой таблицы, подписанные через actor name
  const fkOptions = (
    refTable: keyof DatabaseSnapshot,
    optionLabel: 'actorName' | 'resourcePath' | 'name' | undefined,
    excludeId?: number
  ): TitanSelectOption[] => {
    // @ts-ignore
    const rows = draft[refTable] as Array<Record<string, unknown>>
    return rows
      .filter((r) => (excludeId === undefined ? true : r.id !== excludeId))
      .map((r) => {
        let suffix = ''

        if (optionLabel === 'resourcePath') {
          suffix = ` ${shortenResourcePath(String(r.path ?? ''))}`
        } else if (optionLabel === 'name') {
          suffix = r.name ? ` ${r.name}` : ''
        } else {
          // 'actorName' или undefined — прежнее поведение
          const actorId = r.actorId as number | null | undefined
          const actor = actorId != null ? draft.actors.find((a) => a.id === actorId) : null
          suffix = actor ? ` → ${actor.name}` : r.name ? ` ${r.name}` : ''
        }

        return { value: String(r.id), label: `#${r.id}${suffix}` }
      })
  }

  const renderField = (field: FieldSpec) => {
    const value = row[field.key]
    const fullStyle = field.full ? { gridColumn: '1 / -1' as const } : {}

    switch (field.kind) {
      case 'number':
        return (
          <TitanInput
            key={field.key}
            label={field.label}
            type="number"
            value={value === undefined || value === null ? '' : (value as number)}
            disabled={field.readonly}
            step={field.step}
            min={field.min}
            max={field.max}
            onChange={(v) => update(field.key, v === '' ? null : Number(v))}
            style={fullStyle}
          />
        )

      case 'text':
        return (
          <TitanInput
            key={field.key}
            label={field.label}
            value={(value as string) ?? ''}
            placeholder={field.placeholder}
            disabled={field.readonly}
            onChange={(v) => update(field.key, v)}
            style={fullStyle}
          />
        )

      case 'color':
        return (
          <TitanInput
            key={field.key}
            label={field.label}
            type="color"
            value={(value as string) || '#ffffff'}
            disabled={field.readonly}
            onChange={(v) => update(field.key, v)}
            style={fullStyle}
          />
        )

      case 'textarea':
        return (
          <TitanTextarea
            key={field.key}
            label={field.label}
            value={(value as string) ?? ''}
            placeholder={field.placeholder}
            disabled={field.readonly}
            onChange={(v) => update(field.key, v)}
            style={fullStyle}
          />
        )

      case 'select-fk': {
        const excludeId = field.excludeSelf ? (row.id as number) : undefined
        return (
          <TitanSelect
            key={field.key}
            label={field.label}
            value={value === null || value === undefined ? '' : String(value)}
            placeholder={field.nullable ? '— none —' : undefined}
            options={fkOptions(field.references, field.optionLabel, excludeId)}
            invalid={!field.nullable && (value === null || value === undefined)}
            onChange={(v) => update(field.key, v === '' ? null : Number(v))}
            style={fullStyle}
          />
        )
      }

      case 'select-enum':
        return (
          <TitanSelect
            key={field.key}
            label={field.label}
            value={value === null || value === undefined ? '' : String(value)}
            placeholder={field.nullable ? '— none —' : undefined}
            options={field.options}
            onChange={(v) => {
              if (v === '') return update(field.key, null)
              // enum-значение может быть числом (direction 1/-1) или строкой (resourceType)
              const num = Number(v)
              update(field.key, Number.isNaN(num) || v.trim() === '' ? v : num)
            }}
            style={fullStyle}
          />
        )

      case 'json': {
        // @ts-ignore
        const rowsOfTable = draft[spec.table] as Array<Record<string, unknown>>
        const cloneOptions = rowsOfTable
          .filter((r) => r.id !== row.id)
          .map((r) => {
            const actorId = r.actorId as number | null | undefined
            const actor = actorId != null ? draft.actors.find((a) => a.id === actorId) : null
            const suffix = actor ? ` → ${actor.name}` : ''
            return { value: String(r.id), label: `#${r.id}${suffix}`, data: r[field.key] }
          })

        return (
          <JsonField
            key={field.key}
            label={field.label}
            value={value}
            rows={field.rows}
            cloneOptions={field.cloneFrom ? cloneOptions : undefined}
            onChange={(v) => update(field.key, v)}
          />
        )
      }
    }
  }

  return (
    <div>
      <div className="titan-form-grid">{spec.fields.map(renderField)}</div>

      <div style={{ height: '14px' }} />

      <TitanFlex justify="end">
        <TitanButton onClick={onDelete}>Delete</TitanButton>
      </TitanFlex>
    </div>
  )
}

export default GenericForm
