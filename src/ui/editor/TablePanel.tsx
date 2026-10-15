import { useState } from 'react'
import TitanSimpleList from '@titanui/components/TitanSimpleList'
import TitanButton from '@titanui/components/TitanButton'
import TitanFlex from '@titanui/components/TitanFlex'
import GenericForm from '@/ui/editor/forms/GenericForm'
import { TableSpec, ListLabelContext } from '@/ui/editor/forms/fieldSpec'
import { UseEditorDraft } from '@/ui/editor/useEditorDraft'
import { shortenResourcePath } from '@/ui/editor/forms/shortenResourcePath'

export function TablePanel({ spec, editor }: { spec: TableSpec; editor: UseEditorDraft }) {
  const { draft, upsert, remove, nextId } = editor
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // @ts-expect-error draft[spec.table] access lacks type narrowing
  const rows = draft[spec.table] as Array<Record<string, unknown>>

  const ctx: ListLabelContext = {
    actorName: (actorId) => {
      if (actorId == null) return '∅'
      const actor = draft.actors.find((a) => a.id === actorId)
      return actor ? actor.name : `?${actorId}`
    },
    resourcePath: (resourceId) => {
      if (resourceId == null) return '∅'
      const res = draft.resources.find((r) => r.id === resourceId)
      return res ? shortenResourcePath(res.path) : `?${resourceId}`
    }
  }

  const selected = selectedId === null ? null : (rows.find((r) => r.id === selectedId) ?? null)

  const handleCreate = (): void => {
    const id = nextId(spec.table)
    const fresh = { id, ...spec.defaults() }
    upsert(spec.table, fresh as never)
    setSelectedId(id)
  }

  const handleDelete = (): void => {
    if (selectedId === null) return
    remove(spec.table, selectedId)
    setSelectedId(null)
  }

  return (
    <div className="titan-editor-body">
      <div className="titan-editor-list">
        <TitanFlex justify="between" align="center" style={{ marginBottom: '10px' }}>
          <span className="titan-field-label">{spec.title}</span>
          <TitanButton onClick={handleCreate}>+ New</TitanButton>
        </TitanFlex>
        <TitanSimpleList style={{ maxHeight: '420px' }}>
          {rows.map((r) => (
            <button
              key={r.id as number}
              type="button"
              className="titan-list-item titan-editor-row"
              aria-pressed={r.id === selectedId}
              style={r.id === selectedId ? { background: 'rgba(255,255,255,0.12)' } : {}}
              onClick={() => setSelectedId(r.id as number)}
            >
              {spec.listLabel(r, ctx)}
            </button>
          ))}
        </TitanSimpleList>
      </div>

      <div className="titan-editor-form">
        <GenericForm
          spec={spec}
          row={selected}
          draft={draft}
          getJsonInput={(field) => selectedId === null ? undefined : editor.getJsonInput(spec.table, selectedId, field)}
          onJsonInputChange={(field, state) => {
            if (selectedId !== null) editor.setJsonInput(spec.table, selectedId, field, state)
          }}
          onChange={(updated) => upsert(spec.table, updated as never)}
          onDelete={handleDelete}
        />
      </div>
    </div>
  )
}
