import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TablePanel } from '@/ui/editor/TablePanel'
import { useEditorDraft, type UseEditorDraft } from '@/ui/editor/useEditorDraft'
import { renderingObjectsSpec } from '@/ui/editor/forms/namedSpecs'
import type { GeneratedFile } from '@/core/framework/generation/generateDatabaseFiles'

const { saveSpy } = vi.hoisted(() => ({ saveSpy: vi.fn() }))
vi.mock('@/ui/editor/saveDatabaseFiles', () => ({ saveDatabaseFiles: saveSpy }))

let container: HTMLDivElement
let root: Root
let editor: UseEditorDraft
const first = { size: 300, preset: 'dark', gas: { absorption: 0.7, extension: 'keep' },
  quality: { maxSteps: 96 }, palette: { stops: [{ t: 0, color: '#112233' }, { t: 1, color: '#abcdef' }] },
  cavities: [{ radius: 0.2 }], extension: { keep: true } }
const database = new Map<string, unknown[]>([
  ['categories', [{ id: 1, alias: 'nebula', name: 'Nebula' }, { id: 2, alias: 'barycenter', name: 'Root' }]],
  ['actors', [
    { id: 1, categoryId: 1, parentId: null, name: 'Cloud A', color: '#ffffff', description: '' },
    { id: 2, categoryId: 1, parentId: null, name: 'Cloud B', color: '#ffffff', description: '' },
    { id: 3, categoryId: 2, parentId: null, name: 'Other', color: '#ffffff', description: '' }
  ]],
  ['renderingObjects', [{ id: 1, actorId: 1, data: first }, { id: 2, actorId: 2, data: { size: 200 } }]]
])

function Editor() {
  editor = useEditorDraft(database, [])
  const [shown, show] = useState(true)
  return <><button onClick={() => show(!shown)}>Toggle table</button>
    {shown && <TablePanel spec={renderingObjectsSpec} editor={editor} />}</>
}
function selectRow(id = 1): void {
  act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-editor-row'))
    .find((button) => button.textContent?.startsWith(`#${id} `))!.click())
}
function field(label: string): HTMLInputElement | HTMLSelectElement {
  const element = Array.from(container.querySelectorAll('label')).find((el) =>
    el.querySelector('.titan-field-label')?.textContent === label)?.querySelector('input,select')
  expect(element, label).toBeTruthy()
  return element as HTMLInputElement | HTMLSelectElement
}
function input(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
function edit(label: string, value: string): void { act(() => input(field(label), value)) }
function click(text: string): void {
  const button = Array.from(container.querySelectorAll('button')).find((el) =>
    (el.getAttribute('aria-label') ?? el.textContent) === text)!
  expect(button, text).toBeTruthy()
  act(() => button.click())
}
function data(id = 1): Record<string, unknown> { return editor.draft.renderingObjects.find((row) => row.id === id)!.data }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  saveSpy.mockReset().mockResolvedValue({ ok: true, written: [] })
  act(() => root.render(<Editor />)); selectRow()
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('uses the actor category and displays inherited preset values without writing them', () => {
  expect(field('Gas density').value).toBe('0')
  expect(field('Raymarch steps').value).toBe('96')
  expect(data()).toEqual(first)
  edit('Actor', '3')
  expect(container.textContent).not.toContain('Gas density')
  expect(JSON.parse(container.querySelector('textarea')!.value)).toEqual(first)
})

it('patches nested data losslessly and keeps the advanced JSON in sync', () => {
  edit('Gas absorption', '0.25')
  expect(data()).toEqual({ ...first, gas: { absorption: 0.25, extension: 'keep' } })
  expect(JSON.parse(container.querySelector('textarea')!.value)).toEqual(data())
  edit('Temporal blend', '0.85')
  expect(data().quality).toEqual({ maxSteps: 96, temporalBlend: 0.85 })
  expect(database.get('renderingObjects')![0]).toEqual({ id: 1, actorId: 1, data: first })
})

it('preserves AU/degrees and the other components of a vector', () => {
  edit('Half-size (AU)', '400')
  edit('Shape rotation X (°)', '45')
  edit('Shape rotation Z (°)', '-30')
  edit('Structure direction X', '0.8')
  expect(data().size).toBe(400)
  expect(data().shapeRotation).toEqual([45, 0, -30])
  expect(data().structure).toEqual({ direction: [0.8, 1, 0] })
})

it('keeps explicit zero and null distinct for seeds and anisotropy', () => {
  edit('Dust seed', '0')
  edit('Light anisotropy', '0')
  expect(data().dust).toEqual({ seed: 0 })
  expect(data().lighting).toEqual({ anisotropy: 0 })
  edit('Dust seed', '')
  edit('Light anisotropy', '')
  expect(data().dust).toEqual({ seed: null })
  expect(data().lighting).toEqual({ anisotropy: null })
})

it('changes inherited preset values, retains overrides and supports per-field reset', () => {
  edit('Gas density', '2')
  edit('Preset', 'reflection')
  expect(field('Gas density').value).toBe('2')
  expect(field('Ambient light').value).toBe('0.3')
  click('Reset Gas density')
  expect(data()).not.toHaveProperty('density')
  expect(field('Gas density').value).toBe('4')
  click('Reset Gas absorption')
  expect(data().gas).toEqual({ extension: 'keep' })
})

it.each([['Temporal blend', '1'], ['Raymarch steps', '7'], ['Light steps', '2.5'], ['Gas density', '']])(
  'blocks invalid %s before a captured save runs, then saves the corrected draft', async (label, value) => {
    const save = editor.save
    await act(async () => { input(field(label), value); await save() })
    expect(editor.hasFieldErrors).toBe(true)
    expect(saveSpy).not.toHaveBeenCalled()
    expect(field(label).value).toBe(value)
    click(`Reset ${label}`)
    edit('Gas absorption', '0.4')
    await act(async () => save())
    expect(editor.hasFieldErrors).toBe(false)
    expect(editor.validation.errors).toEqual([])
    const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
    expect(files.find((file) => file.path.includes('renderingObjects'))?.content).toContain('absorption: 0.4')
  })

it('retains invalid controls across record and table switches without leaking them to another record', async () => {
  edit('Temporal blend', '1.5')
  selectRow(2)
  expect(field('Temporal blend').value).toBe('0')
  edit('Gas density', '3')
  click('Toggle table')
  await act(async () => editor.save())
  expect(saveSpy).not.toHaveBeenCalled()
  click('Toggle table'); selectRow()
  expect(field('Temporal blend').value).toBe('1.5')
  expect(data(2).density).toBe(3)
  click('Delete')
  expect(editor.hasFieldErrors).toBe(false)
})

it('disables controls during invalid JSON and discards obsolete drafts on valid JSON replacement', () => {
  edit('Temporal blend', '1.5')
  act(() => input(container.querySelector('textarea')!, '{ invalid'))
  expect(field('Gas density').closest('fieldset')!.disabled).toBe(true)
  expect(container.querySelector('textarea')!.value).toBe('{ invalid')
  selectRow(2); selectRow()
  expect(container.querySelector('textarea')!.value).toBe('{ invalid')
  act(() => input(container.querySelector('textarea')!, '{"size":123,"quality":{"temporalBlend":0.6},"extra":42}'))
  expect(editor.hasFieldErrors).toBe(false)
  expect(field('Temporal blend').value).toBe('0.6')
  expect(field('Gas density').closest('fieldset')!.disabled).toBe(false)
  edit('Gas density', '2')
  expect(data().extra).toBe(42)
})

it('templates clear stale form drafts and use the same validated save path', async () => {
  edit('Gas density', '')
  act(() => input(container.querySelector('textarea')!, '{ invalid'))
  const template = Array.from(container.querySelectorAll('select')).find((el) =>
    el.querySelector('option[value="nebula"]'))!
  act(() => input(template, 'nebula'))
  expect(editor.hasFieldErrors).toBe(false)
  expect(field('Gas density').value).toBe('0.5')
  await act(async () => editor.save())
  expect(saveSpy).toHaveBeenCalledTimes(1)
})

it.each(['null', '[]', '1', 'true', '"x"', '{"size":30,"quality":null}', '{"size":30,"structure":[]}'])(
  'retains malformed object data %s and lets JSON recover without a crash', (text) => {
    act(() => input(container.querySelector('textarea')!, text))
    expect(editor.hasFieldErrors).toBe(true)
    expect(container.querySelector('textarea')!.value).toBe(text)
    expect(container.querySelector('.nebula-editor-fields')).toBeNull()
    act(() => input(container.querySelector('textarea')!, '{"size":30}'))
    expect(editor.hasFieldErrors).toBe(false)
    expect(field('Gas density').value).toBe('4')
  })

it('validates authored JSON controls synchronously and preserves unknown siblings when corrected', async () => {
  const save = editor.save
  await act(async () => {
    input(container.querySelector('textarea')!, '{"size":30,"quality":{"temporalBlend":1.5,"custom":7}}')
    await save()
  })
  expect(saveSpy).not.toHaveBeenCalled()
  expect(field('Temporal blend').value).toBe('1.5')
  edit('Temporal blend', '0.8')
  expect(editor.hasFieldErrors).toBe(false)
  expect(data().quality).toEqual({ temporalBlend: 0.8, custom: 7 })
})

it('turns an optional light point on and off without losing other light parameters', () => {
  edit('Light scattering', '2')
  edit('Star light', 'point')
  edit('Star position X', '1234')
  edit('Star position Z', '-7')
  expect(data().lighting).toEqual({ scatterStrength: 2, starPosition: [1234, 0, -7] })
  edit('Star position Y', '')
  expect(editor.hasFieldErrors).toBe(true)
  edit('Star light', 'off')
  expect(editor.hasFieldErrors).toBe(false)
  expect(data().lighting).toEqual({ scatterStrength: 2, starPosition: null })
})

it('rejects zero structure direction and retains the last complete vector until corrected', () => {
  edit('Structure direction Y', '0')
  expect(editor.hasFieldErrors).toBe(true)
  expect(data()).not.toHaveProperty('structure')
  edit('Structure direction X', '1')
  expect(editor.hasFieldErrors).toBe(false)
  expect(data().structure).toEqual({ direction: [1, 0, 0] })
})

it.each(['actor', 'category'])('ignores obsolete nebula-only errors when the %s changes while another table is open', async (change) => {
  edit('Temporal blend', '1.5')
  click('Toggle table')
  const save = editor.save
  await act(async () => {
    if (change === 'actor') editor.upsert('renderingObjects', { ...editor.draft.renderingObjects[0], actorId: 3 })
    else editor.upsert('actors', { ...editor.draft.actors[0], categoryId: 2 })
    await save()
  })
  expect(editor.hasFieldErrors).toBe(false)
  expect(saveSpy).toHaveBeenCalledTimes(1)
})
