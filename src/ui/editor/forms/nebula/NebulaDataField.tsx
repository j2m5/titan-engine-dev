import { useEffect, useMemo, useState } from 'react'
import TitanInput from '@titanui/components/TitanInput'
import TitanSelect from '@titanui/components/TitanSelect'
import JsonField, { type JsonFieldProps, type JsonInputState } from '@/ui/editor/forms/JsonField'
import {
  NEBULA_EDITOR_GROUPS, controlError, draftedValue, editorDefaults, effectiveValue, fieldError,
  isRecord, patchPath, readPath, structureError, type ControlDrafts, type NebulaEditorField
} from './nebulaEditorModel'

interface Props extends JsonFieldProps {
  controlsInputState?: JsonInputState
  onControlsInputChange?(state: JsonInputState): void
}
const jsonText = (value: unknown): string => JSON.stringify(value ?? {}, null, 2)
function decodeDrafts(state: JsonInputState | undefined): ControlDrafts {
  if (!state) return {}
  try {
    const value: unknown = JSON.parse(state.text)
    return isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
  } catch { return {} }
}

export default function NebulaDataField({ value, inputState, onInputChange, controlsInputState, onControlsInputChange, onChange, ...jsonProps }: Props) {
  const [localJson, setLocalJson] = useState<JsonInputState>(() => ({ text: jsonText(value), error: null }))
  const [localControls, setLocalControls] = useState<JsonInputState>({ text: '{}', error: null })
  const json = inputState ?? localJson
  const controls = controlsInputState ?? localControls
  const drafts = useMemo(() => decodeDrafts(controls), [controls])
  const defaults = useMemo(() => editorDefaults(value), [value])
  const error = controlError(value, drafts)
  const malformed = structureError(value)
  const setJson = onInputChange ?? setLocalJson
  const setControls = onControlsInputChange ?? setLocalControls

  // Existing malformed data must also block Save after opening the form.
  useEffect(() => {
    if (controls.error !== error) setControls({ text: controls.text, error })
  }, [controls.error, controls.text, error, setControls])

  const publish = (data: unknown, nextDrafts: ControlDrafts): void => {
    setControls({ text: JSON.stringify(nextDrafts), error: controlError(data, nextDrafts) })
    setJson({ text: jsonText(data), error: null })
    onChange(data)
  }
  const withoutDraft = (path: string): ControlDrafts => Object.fromEntries(Object.entries(drafts)
    .filter(([key]) => key !== path && !key.startsWith(`${path}.`)))
  const commit = (field: NebulaEditorField, next: unknown): void => {
    if (!isRecord(value)) return
    publish(patchPath(value, field.path, next), withoutDraft(field.path))
  }
  const reset = (field: NebulaEditorField): void => commit(field, field.required ? readPath(defaults, field.path) : undefined)
  const inputNumber = (field: NebulaEditorField, key: string, text: string): void => {
    if (!isRecord(value)) return
    const nextDrafts = { ...drafts, [key]: text }
    const next = draftedValue(field, effectiveValue(value, defaults, field.path), nextDrafts)
    if (fieldError(field, next)) {
      setControls({ text: JSON.stringify(nextDrafts), error: controlError(value, nextDrafts) })
    } else publish(patchPath(value, field.path, next), nextDrafts)
  }

  const renderField = (field: NebulaEditorField) => {
    const current = effectiveValue(value, defaults, field.path)
    const visibleValue = draftedValue(field, current, drafts)
    const problem = field.required && readPath(value, field.path) === undefined ? 'Enter a value.' : fieldError(field, visibleValue)
    const numericInput = (label: string, key: string, numberValue: unknown, nullable?: string) => <TitanInput
      label={label} type="number" value={drafts[key] ?? (typeof numberValue === 'number' ? numberValue : '')}
      min={field.min ?? (field.positive ? 0 : undefined)} max={field.max} step={field.integer ? 1 : 'any'}
      invalid={!!problem} placeholder={nullable} onChange={(text) => inputNumber(field, key, text)} />
    return <div className={`nebula-editor-control${field.kind === 'vector' ? ' nebula-editor-wide' : ''}`} key={field.path}>
      {field.kind === 'number' && numericInput(field.label, field.path, current, field.nullable)}
      {field.kind === 'vector' && <>
        {field.nullable && <TitanSelect label="Star light" value={current === null ? 'off' : 'point'}
          options={[{ value: 'off', label: field.nullable }, { value: 'point', label: 'Fixed world position' }]}
          onChange={(mode) => commit(field, mode === 'off' ? null : [0, 0, 0])} />}
        {current !== null && <div className="nebula-editor-vector">{['X', 'Y', 'Z'].map((axis, i) =>
          <div key={axis}>{numericInput(`${field.label} ${axis}${field.unit ? ` (${field.unit})` : ''}`, `${field.path}.${i}`, Array.isArray(current) ? current[i] : undefined)}</div>)}</div>}
      </>}
      {field.kind === 'color' && <TitanInput label={field.label} type="color" value={typeof current === 'string' ? current : ''}
        invalid={!!problem} onChange={(color) => commit(field, color)} />}
      {(field.kind === 'select' || field.kind === 'boolean') && <TitanSelect label={field.label} value={String(current ?? '')}
        invalid={!!problem} options={field.options ?? [{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]}
        onChange={(choice) => commit(field, field.kind === 'boolean' ? choice === 'true' : choice === '' ? undefined : choice)} />}
      <div className="nebula-editor-field-footer">
        <span className={problem ? 'nebula-editor-error' : 'nebula-editor-hint'}>{problem ?? field.help ?? field.nullable}</span>
        <button className="nebula-editor-reset" type="button" aria-label={`Reset ${field.label}`} onClick={() => reset(field)}>Reset</button>
      </div>
    </div>
  }

  return <div className="nebula-editor">
    <p className="nebula-editor-hint">Nebula parameters · Reset restores the inherited value. Save changes, then reload the scenario to see them.</p>
    {json.error && <p className="nebula-editor-error" role="alert">Correct Advanced JSON before editing parameters.</p>}
    {error && <p className="nebula-editor-error" role="alert">{error}</p>}
    {!malformed && <fieldset className="nebula-editor-fields" disabled={!!json.error}>
      <legend className="nebula-editor-legend">Nebula parameters</legend>
      {NEBULA_EDITOR_GROUPS.map((group) => <details className="nebula-editor-section" key={group.title} open={group.open}>
        <summary>{group.title}</summary><p className="nebula-editor-hint">{group.help}</p>
        <div className="titan-form-grid">{group.fields.map(renderField)}</div>
      </details>)}
    </fieldset>}
    <details className="nebula-editor-section" open={!!json.error || !!malformed || undefined}>
      <summary>Advanced JSON</summary>
      <p className="nebula-editor-hint">Full data, color stops, lobes and cavities. Templates and cloning replace the entire data object.</p>
      <JsonField {...jsonProps} value={value} inputState={json} onInputChange={setJson} onChange={(data) => {
        setControls({ text: '{}', error: controlError(data, {}) })
        onChange(data)
      }} />
    </details>
  </div>
}
