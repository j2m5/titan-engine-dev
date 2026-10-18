import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useEditorDraft, type UseEditorDraft } from '@/ui/editor/useEditorDraft'
import type { SaveResult } from '@/ui/editor/saveDatabaseFiles'
import { TablePanel } from '@/ui/editor/TablePanel'
import type { TableSpec } from '@/ui/editor/forms/fieldSpec'
import type { GeneratedFile } from '@/core/framework/generation/generateDatabaseFiles'
import DataEditorModal from '@/ui/editor/DataEditorModal'

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

const JSON_DATABASE = new Map<string, unknown[]>([
  ['categories', [
    { id: 1, name: 'First', data: { seed: 1 } },
    { id: 2, name: 'Second', data: { seed: 2 } }
  ]]
])
const jsonSpec: TableSpec = {
  table: 'categories', title: 'Categories', defaults: () => ({ name: 'New', data: {} }),
  listLabel: (row) => String(row.name),
  fields: [{ key: 'data', label: 'Data', kind: 'json', templates: [
    { value: 'preset', label: 'Preset', data: { seed: 42 } }
  ] }]
}

function JsonEditor() {
  editor = useEditorDraft(JSON_DATABASE, [])
  const [showTable, setShowTable] = useState(true)
  return <>
    <button onClick={() => setShowTable(!showTable)}>Switch table</button>
    {showTable && <TablePanel spec={jsonSpec} editor={editor} />}
    <output>{editor.saveStatus}</output>
  </>
}

function click(text: string): void {
  const target = Array.from(container.querySelectorAll('button, .titan-list-item')).find((el) => el.textContent?.trim() === text)
  expect(target, text).toBeTruthy()
  act(() => (target as HTMLElement).click())
}

function inputJson(text: string): void {
  const field = container.querySelector('textarea')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('JSON field and editor save integration', () => {
  beforeEach(() => {
    act(() => root.render(<JsonEditor />))
    saveSpy.mockResolvedValue({ ok: true, written: [] })
    click('First')
  })

  it('blocks a captured save callback in the same tick as invalid input, then saves corrected content', async () => {
    const save = editor.save
    await act(async () => {
      inputJson('{"seed":')
      await save()
    })
    expect(saveSpy).not.toHaveBeenCalled()
    expect(editor.saveStatus).toContain('Cannot save')
    expect(editor.hasFieldErrors).toBe(true)

    await act(async () => {
      inputJson('{"seed": 9}')
      await save()
    })
    expect(editor.hasFieldErrors).toBe(false)
    const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
    expect(files.find((file) => file.path.includes('categories'))?.content).toContain('seed: 9')
  })

  it('retains invalid text/errors across record and table switches, deletion clears only its errors', async () => {
    act(() => inputJson('{ first'))
    click('Second')
    act(() => inputJson('{ second'))
    click('First')
    expect(container.querySelector('textarea')?.value).toBe('{ first')
    expect(container.textContent).toContain('JSON error')
    click('Switch table')
    await act(async () => editor.save())
    expect(saveSpy).not.toHaveBeenCalled()
    click('Switch table')
    click('First')
    expect(container.querySelector('textarea')?.value).toBe('{ first')
    click('Delete')
    await act(async () => editor.save())
    expect(saveSpy).not.toHaveBeenCalled()
    click('Second')
    expect(container.querySelector('textarea')?.value).toBe('{ second')
    click('Delete')
    await act(async () => editor.save())
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('a template replaces invalid input and clears the save blocker', async () => {
    act(() => inputJson('{ broken'))
    const select = container.querySelector('select')!
    act(() => {
      select.value = 'preset'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).not.toContain('JSON error')
    await act(async () => editor.save())
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
    expect(files.find((file) => file.path.includes('categories'))?.content).toContain('seed: 42')
  })

  it('does not report an older in-flight save as Saved after the input changes', async () => {
    let finish: (result: SaveResult) => void = () => {}
    saveSpy.mockReturnValue(new Promise<SaveResult>((resolve) => (finish = resolve)))
    let pending: Promise<void> = Promise.resolve()
    act(() => { pending = editor.save() })
    act(() => inputJson('{ changed while saving'))
    await act(async () => {
      finish({ ok: true, written: [] })
      await pending
    })
    expect(editor.saveStatus).not.toContain('Saved')
    expect(editor.hasFieldErrors).toBe(true)
    expect(editor.saving).toBe(false)
  })
})

it('the real editor modal disables Save for invalid JSON, including after switching tables', () => {
  act(() => root.render(<DataEditorModal visible onClose={() => {}} />))
  const switchTo = (title: string): void => {
    const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-tab'))
      .find((button) => button.textContent?.startsWith(title))!
    act(() => tab.click())
  }
  const saveButton = (): HTMLButtonElement => Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent === 'Save to generated')!
  expect(saveButton().disabled).toBe(false)
  switchTo('Rendering')
  act(() => container.querySelector<HTMLElement>('.titan-list-item')!.click())
  const original = container.querySelector('textarea')!.value
  act(() => inputJson('{ invalid'))
  expect(saveButton().disabled).toBe(true)
  expect(container.textContent).toContain('Invalid input — cannot save')
  switchTo('Actors')
  expect(saveButton().disabled).toBe(true)
  switchTo('Rendering')
  expect(container.querySelector('textarea')!.value).toBe('{ invalid')
  act(() => inputJson(original))
  expect(saveButton().disabled).toBe(false)
})
