import { FC, useMemo, useState } from 'react'
import { Closable } from '@titanui/types'
import TitanTabs, { TitanTab } from '@titanui/components/TitanTabs'
import TitanSimpleList from '@titanui/components/TitanSimpleList'
import TitanListItem from '@titanui/components/TitanListItem'
import TitanButton from '@titanui/components/TitanButton'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanDivider from '@titanui/components/TitanDivider'
import ActorForm from '@/ui/editor/forms/ActorForm'
import { useEditorDraft } from '@/ui/editor/useEditorDraft'
import { database } from '@/config/database'
import { Scenarios } from '@/config/scenarios'
import { ScenarioRefs } from '@/core/framework/validation/validateDatabase'
import { IActor } from '@/core/models/types'

const DataEditorModal: FC<Closable & { visible: boolean }> = ({ visible, onClose }) => {
  const scenarioRefs: ScenarioRefs[] = useMemo(
    () =>
      Scenarios.map((s) => ({
        id: s.id,
        rootId: s.rootId,
        galaxyId: s.galaxyId,
        lightSources: s.lightSources,
        skybox: s.skybox
      })),
    []
  )

  // @ts-ignore
  const editor = useEditorDraft(database, scenarioRefs)
  const { draft, validation, saving, saveStatus, upsert, remove, nextId, save } = editor

  const [activeTable, setActiveTable] = useState('actors')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const tabs: TitanTab[] = [
    { key: 'actors', label: 'Actors', badge: draft.actors.length },
    { key: 'orbits', label: 'Orbits', badge: draft.orbits.length },
    { key: 'physicalObjects', label: 'Physical', badge: draft.physicalObjects.length },
    { key: 'renderingObjects', label: 'Rendering', badge: draft.renderingObjects.length },
    { key: 'rotationObjects', label: 'Rotation', badge: draft.rotationObjects.length },
    { key: 'placements', label: 'Placements', badge: draft.placements.length },
    { key: 'resources', label: 'Resources', badge: draft.resources.length },
    { key: 'categories', label: 'Categories', badge: draft.categories.length }
  ]

  const selectedActor: IActor | null =
    selectedId === null ? null : (draft.actors.find((a) => a.id === selectedId) ?? null)

  const handleCreateActor = (): void => {
    const id = nextId('actors')
    const fresh: IActor = {
      id,
      categoryId: draft.categories[0]?.id ?? 0,
      parentId: null,
      name: `New Actor ${id}`,
      description: '',
      color: '#ffffff'
    }
    upsert('actors', fresh)
    setSelectedId(id)
  }

  const handleDeleteActor = (): void => {
    if (selectedId === null) return
    remove('actors', selectedId)
    setSelectedId(null)
  }

  // ошибки/предупреждения, относящиеся к текущей таблице — для панели снизу
  const tableIssues = validation.issues.filter((i) => i.collection === activeTable)

  const actions = (
    <TitanFlex align="center" style={{ gap: '10px' }}>
      <span style={{ fontSize: '12px', color: validation.ok ? '#bbbbbb' : '#c0392b' }}>
        {validation.ok
          ? saveStatus || `${validation.warnings.length} warning(s)`
          : `${validation.errors.length} error(s) — cannot save`}
      </span>
      <TitanButton onClick={save}>{saving ? 'Saving…' : 'Save to generated'}</TitanButton>
      <TitanButton onClick={onClose}>Close</TitanButton>
    </TitanFlex>
  )

  return (
    <ModalWindowWide visible={visible} title="Data Editor" actions={actions} onClose={onClose}>
      <TitanTabs
        tabs={tabs}
        active={activeTable}
        onChange={(k) => {
          setActiveTable(k)
          setSelectedId(null)
        }}
      />

      <div style={{ height: '14px' }} />

      {activeTable === 'actors' ? (
        <div className="titan-editor-body">
          {/* список слева */}
          <div className="titan-editor-list">
            <TitanFlex justify="between" align="center" style={{ marginBottom: '10px' }}>
              <span className="titan-field-label">Actors</span>
              <TitanButton onClick={handleCreateActor}>+ New</TitanButton>
            </TitanFlex>
            <TitanSimpleList style={{ maxHeight: '420px' }}>
              {draft.actors.map((a) => (
                <TitanListItem
                  key={a.id}
                  style={a.id === selectedId ? { background: 'rgba(255,255,255,0.12)' } : {}}
                  onClick={() => setSelectedId(a.id)}
                >
                  <TitanFlex align="center" justify="between" width="100%">
                    <span>{a.name}</span>
                    <span style={{ color: '#888', fontSize: '12px' }}>{a.id}</span>
                  </TitanFlex>
                </TitanListItem>
              ))}
            </TitanSimpleList>
          </div>

          {/* форма справа */}
          <div className="titan-editor-form">
            <ActorForm
              actor={selectedActor}
              actors={draft.actors}
              categories={draft.categories}
              onChange={(updated) => upsert('actors', updated)}
              onDelete={handleDeleteActor}
            />
          </div>
        </div>
      ) : (
        <div style={{ color: '#888', padding: '30px', textAlign: 'center' }}>
          “{activeTable}” editor — coming next. Каркас расширения готов: добавить форму по образцу ActorForm и ветку
          рендера.
        </div>
      )}

      {/* панель issues текущей таблицы */}
      {tableIssues.length > 0 && (
        <>
          <TitanDivider offsetTop={14} offsetBottom={10} />
          <div className="titan-editor-issues">
            {tableIssues.map((issue, i) => (
              <div key={i} className={`titan-issue ${issue.level}`}>
                [{issue.level}] {issue.message}
              </div>
            ))}
          </div>
        </>
      )}
    </ModalWindowWide>
  )
}

import TitanModal from '@titanui/components/TitanModal'
import { ReactNode } from 'react'

const ModalWindowWide: FC<Closable & { visible: boolean; title: string; actions: ReactNode; children: ReactNode }> = ({
  visible,
  title,
  actions,
  children
}) => (
  <TitanModal visible={visible} title={title} actions={actions} width={920} height="auto">
    {children}
  </TitanModal>
)

export default DataEditorModal
