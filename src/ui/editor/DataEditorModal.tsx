import { FC, useMemo, useState, ReactNode } from 'react'
import { Closable } from '@titanui/types'
import TitanModal from '@titanui/components/TitanModal'
import TitanTabs, { TitanTab } from '@titanui/components/TitanTabs'
import TitanButton from '@titanui/components/TitanButton'
import TitanFlex from '@titanui/components/TitanFlex'
import TitanDivider from '@titanui/components/TitanDivider'
import { TablePanel } from '@/ui/editor/TablePanel'
import { useEditorDraft } from '@/ui/editor/useEditorDraft'
import { editorSpecs, specByTable } from '@/ui/editor/forms/editorSpecs'
import { database } from '@/config/database'
import { Scenarios } from '@/config/scenarios'
import { ScenarioRefs, DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'

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
  const { draft, validation, saving, saveStatus, save } = editor

  const [activeTable, setActiveTable] = useState<string>('actors')

  // табы строятся из реестра спеков + два «coming next» в конце
  const tabs: TitanTab[] = [
    ...editorSpecs.map((s) => ({
      key: s.table as string,
      label: s.title,
      badge: (draft[s.table as keyof DatabaseSnapshot] as unknown[]).length
    })),
    { key: 'renderingObjects', label: 'Rendering', badge: draft.renderingObjects.length },
    { key: 'resources', label: 'Resources', badge: draft.resources.length }
  ]

  const tableIssues = validation.issues.filter((i) => i.collection === activeTable)
  const activeSpec = specByTable[activeTable]

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
    <ModalWindowWide visible={visible} title="Data Editor" actions={actions}>
      <TitanTabs tabs={tabs} active={activeTable} onChange={setActiveTable} />

      <div style={{ height: '14px' }} />

      {activeSpec ? (
        <TablePanel spec={activeSpec} editor={editor} />
      ) : (
        <div style={{ color: '#888', padding: '30px', textAlign: 'center' }}>“{activeTable}” editor — coming next.</div>
      )}

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

const ModalWindowWide: FC<{ visible: boolean; title: string; actions: ReactNode; children: ReactNode }> = ({
  visible,
  title,
  actions,
  children
}) => (
  <TitanModal
    visible={visible}
    title={title}
    actions={actions}
    width={920}
    height="auto"
    className="titan-modal-solid"
    dimScene
  >
    {children}
  </TitanModal>
)

export default DataEditorModal
