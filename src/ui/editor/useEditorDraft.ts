import { useCallback, useMemo, useRef, useState } from 'react'
import {
  IActor,
  ICategory,
  IOrbit,
  IPhysicalObject,
  IPlacement,
  IRenderingObject,
  IResource,
  IRotationObject
} from '@/core/models/types'
import {
  DatabaseSnapshot,
  ScenarioRefs,
  validateDatabase,
  ValidationResult
} from '@/core/framework/validation/validateDatabase'
import { generateDatabaseFiles } from '@/core/framework/generation/generateDatabaseFiles'
import { saveDatabaseFiles, SaveResult } from '@/ui/editor/saveDatabaseFiles'

type TableName = keyof DatabaseSnapshot

/** любая запись таблицы имеет числовой id */
interface WithId {
  id: number
}

function snapshotFromDatabase(database: Map<string, unknown[]>): DatabaseSnapshot {
  // глубокая копия, чтобы правка черновика не мутировала живой database
  const clone = <T>(rows: unknown[]): T[] => rows.map((r) => structuredClone(r)) as T[]

  return {
    categories: clone<ICategory>(database.get('categories') ?? []),
    actors: clone<IActor>(database.get('actors') ?? []),
    orbits: clone<IOrbit>(database.get('orbits') ?? []),
    rotationObjects: clone<IRotationObject>(database.get('rotationObjects') ?? []),
    physicalObjects: clone<IPhysicalObject>(database.get('physicalObjects') ?? []),
    renderingObjects: clone<IRenderingObject>(database.get('renderingObjects') ?? []),
    placements: clone<IPlacement>(database.get('placements') ?? []),
    resources: clone<IResource>(database.get('resources') ?? [])
  }
}

export interface UseEditorDraft {
  draft: DatabaseSnapshot
  validation: ValidationResult
  saving: boolean
  saveStatus: string
  /** заменить все записи таблицы (обновление/добавление/удаление идут через это) */
  setTable<T extends TableName>(table: T, rows: DatabaseSnapshot[T]): void
  /** обновить одну запись по id */
  upsert<T extends TableName>(table: T, row: DatabaseSnapshot[T][number]): void
  /** удалить запись по id */
  remove(table: TableName, id: number): void
  /** монотонный автоинкремент per-table за сессию */
  nextId(table: TableName): number
  save(): Promise<void>
}

export function useEditorDraft(database: Map<string, unknown[]>, scenarios: ScenarioRefs[]): UseEditorDraft {
  const [draft, setDraft] = useState<DatabaseSnapshot>(() => snapshotFromDatabase(database))
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  /**
   * Монотонные счётчики per-table
   */
  const counters = useRef<Record<string, number>>(
    Object.fromEntries(
      (Object.keys(draft) as TableName[]).map((table) => {
        const rows = draft[table] as WithId[]
        const max = rows.reduce((m, r) => Math.max(m, r.id), 0)
        return [table, max]
      })
    )
  )

  const nextId = useCallback((table: TableName): number => {
    counters.current[table] += 1
    return counters.current[table]
  }, [])

  const setTable = useCallback(<T extends TableName>(table: T, rows: DatabaseSnapshot[T]): void => {
    setDraft((prev) => ({ ...prev, [table]: rows }))
  }, [])

  const upsert = useCallback(<T extends TableName>(table: T, row: DatabaseSnapshot[T][number]): void => {
    setDraft((prev) => {
      const rows = prev[table] as WithId[]
      const idx = rows.findIndex((r) => r.id === (row as WithId).id)
      const next = idx === -1 ? [...rows, row] : rows.map((r, i) => (i === idx ? row : r))
      return { ...prev, [table]: next }
    })
  }, [])

  const remove = useCallback((table: TableName, id: number): void => {
    setDraft((prev) => {
      const rows = prev[table] as WithId[]
      return { ...prev, [table]: rows.filter((r) => r.id !== id) }
    })
  }, [])

  // валидация черновика на каждый рендер — дёшево, данные невелики
  const validation = useMemo(() => validateDatabase(draft, scenarios), [draft, scenarios])

  const save = useCallback(async (): Promise<void> => {
    if (!validation.ok) {
      setSaveStatus(`Cannot save: ${validation.errors.length} error(s). Fix them first.`)
      return
    }

    setSaving(true)
    setSaveStatus('Generating & writing…')

    try {
      const files = generateDatabaseFiles(draft, scenarios)
      const result: SaveResult = await saveDatabaseFiles(files)
      setSaveStatus(
        result.ok ? `Saved ${result.written?.length ?? 0} file(s) to generated/` : `Failed: ${result.error}`
      )
    } catch (error) {
      setSaveStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }, [draft, scenarios, validation])

  return { draft, validation, saving, saveStatus, setTable, upsert, remove, nextId, save }
}
