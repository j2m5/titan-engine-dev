import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useEditorDraft, type UseEditorDraft } from '@/ui/editor/useEditorDraft'
import type { SaveResult } from '@/ui/editor/saveDatabaseFiles'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const { saveSpy } = vi.hoisted(() => ({ saveSpy: vi.fn() }))

vi.mock('@/ui/editor/saveDatabaseFiles', () => ({ saveDatabaseFiles: saveSpy }))

let container: HTMLDivElement
let root: Root
let editor: UseEditorDraft

/** Пустая база валидна и генерируется — для проверки транспорта содержимое не нужно */
const EMPTY_DATABASE = new Map<string, unknown[]>()

function Probe(): null {
  editor = useEditorDraft(EMPTY_DATABASE, [])
  return null
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Probe />))
  saveSpy.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Редактор данных: сохранение', () => {
  it('двойной клик до перерисовки — один набор файлов уходит на сервер', async () => {
    let finish: (result: SaveResult) => void = () => {}

    saveSpy.mockReturnValue(new Promise<SaveResult>((resolve) => (finish = resolve)))

    const save = editor.save

    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()

    act(() => {
      first = save()
      second = save()
    })

    expect(saveSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      finish({ ok: true, written: [] })
      await Promise.all([first, second])
    })

    expect(editor.saving).toBe(false)
  })

  it('после завершения следующее сохранение снова уходит', async () => {
    saveSpy.mockResolvedValue({ ok: true, written: [] })

    await act(async () => {
      await editor.save()
    })
    await act(async () => {
      await editor.save()
    })

    expect(saveSpy).toHaveBeenCalledTimes(2)
  })
})
