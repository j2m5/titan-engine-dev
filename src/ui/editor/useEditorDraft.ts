import { useCallback, useMemo, useRef, useState } from 'react'
import {
  IActor,
  IActorResource,
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
import type { JsonInputState } from '@/ui/editor/forms/JsonField'

type TableName = keyof DatabaseSnapshot
type JsonInputs = Record<string, JsonInputState & { table: TableName; id: number }>
const inputKey = (table: TableName, id: number, field: string): string => JSON.stringify([table, id, field])

function hasInvalidInput(inputs: JsonInputs, draft: DatabaseSnapshot): boolean {
  return Object.values(inputs).some((input) => {
    if (input.error === null) return false
    if (!input.category) return true
    const row = draft.renderingObjects.find((entry) => entry.id === input.id)
    const actor = draft.actors.find((entry) => entry.id === row?.actorId)
    return input.table === 'renderingObjects' &&
      draft.categories.find((entry) => entry.id === actor?.categoryId)?.alias === input.category
  })
}

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
    resources: clone<IResource>(database.get('resources') ?? []),
    actorResource: clone<IActorResource>(database.get('actorResource') ?? [])
  }
}

export interface UseEditorDraft {
  draft: DatabaseSnapshot
  validation: ValidationResult
  saving: boolean
  saveStatus: string
  hasFieldErrors: boolean
  getJsonInput(table: TableName, id: number, field: string): JsonInputState | undefined
  setJsonInput(table: TableName, id: number, field: string, state: JsonInputState): void
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
  const draftRef = useRef(draft)
  const [jsonInputs, setJsonInputs] = useState<JsonInputs>({})
  const jsonInputsRef = useRef(jsonInputs)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  /**
   * Сохранение в полёте. Флаг состояния для этого не годится: второй клик до
   * перерисовки видит в замыкании ещё false — и второй набор файлов уходил
   * параллельно первому
   */
  const inFlight = useRef(false)
  const revision = useRef(0)

  // Refs update during edits, before React renders: even a previously captured
  // save callback must see the current input errors and corrected draft.
  const updateInputs = useCallback((next: JsonInputs): void => {
    revision.current += 1
    jsonInputsRef.current = next
    setJsonInputs(next)
    setSaveStatus('')
  }, [])
  const getJsonInput = useCallback((table: TableName, id: number, field: string) =>
    jsonInputsRef.current[inputKey(table, id, field)], [])
  const setJsonInput = useCallback((table: TableName, id: number, field: string, state: JsonInputState): void => {
    updateInputs({ ...jsonInputsRef.current, [inputKey(table, id, field)]: { ...state, table, id } })
  }, [updateInputs])
  const updateDraft = useCallback((next: DatabaseSnapshot): void => {
    revision.current += 1
    draftRef.current = next
    setDraft(next)
    setSaveStatus('')
  }, [])

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
    updateDraft({ ...draftRef.current, [table]: rows })
    updateInputs(Object.fromEntries(Object.entries(jsonInputsRef.current).filter(([, input]) => input.table !== table)))
  }, [updateDraft, updateInputs])

  const upsert = useCallback(<T extends TableName>(table: T, row: DatabaseSnapshot[T][number]): void => {
    const rows = draftRef.current[table] as WithId[]
    const idx = rows.findIndex((r) => r.id === (row as WithId).id)
    const next = idx === -1 ? [...rows, row] : rows.map((r, i) => (i === idx ? row : r))
    updateDraft({ ...draftRef.current, [table]: next })
  }, [updateDraft])

  const remove = useCallback((table: TableName, id: number): void => {
    const rows = draftRef.current[table] as WithId[]
    updateDraft({ ...draftRef.current, [table]: rows.filter((r) => r.id !== id) })
    updateInputs(Object.fromEntries(Object.entries(jsonInputsRef.current).filter(([, input]) => input.table !== table || input.id !== id)))
  }, [updateDraft, updateInputs])

  // валидация черновика на каждый рендер — дёшево, данные невелики
  const validation = useMemo(() => validateDatabase(draft, scenarios), [draft, scenarios])
  const hasFieldErrors = hasInvalidInput(jsonInputs, draft)

  const save = useCallback(async (): Promise<void> => {
    if (hasInvalidInput(jsonInputsRef.current, draftRef.current)) {
      setSaveStatus('Cannot save: invalid input. Fix field errors first.')
      return
    }
    const currentDraft = draftRef.current
    const currentValidation = validateDatabase(currentDraft, scenarios)
    if (!currentValidation.ok) {
      setSaveStatus(`Cannot save: ${currentValidation.errors.length} error(s). Fix them first.`)
      return
    }

    if (inFlight.current) return

    inFlight.current = true
    const savedRevision = revision.current
    setSaving(true)
    setSaveStatus('Generating & writing…')

    try {
      const files = generateDatabaseFiles(currentDraft, scenarios)
      const result: SaveResult = await saveDatabaseFiles(files)
      if (revision.current === savedRevision) {
        setSaveStatus(result.ok ? `Saved ${result.written?.length ?? 0} file(s) to database/` : `Failed: ${result.error}`)
      }
    } catch (error) {
      if (revision.current === savedRevision) {
        setSaveStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [scenarios])

  return { draft, validation, saving, saveStatus, hasFieldErrors, getJsonInput, setJsonInput, setTable, upsert, remove, nextId, save }
}
