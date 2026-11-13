import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useEditorDraft, type UseEditorDraft } from '@/ui/editor/useEditorDraft'
import type { SaveResult } from '@/ui/editor/saveDatabaseFiles'
import { TablePanel } from '@/ui/editor/TablePanel'
import type { TableSpec } from '@/ui/editor/forms/fieldSpec'
import type { GeneratedFile } from '@/core/framework/generation/generateDatabaseFiles'
import DataEditorModal from '@/ui/editor/DataEditorModal'
import { renderingObjectsSpec } from '@/ui/editor/forms/namedSpecs'
import { renderingDataTemplates } from '@/ui/editor/forms/dataTemplates'
import { createAtmosphereUniforms, type AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { actorsSpec } from '@/ui/editor/forms/namedSpecs'
import { shippedSnapshot } from '../helpers/shippedSnapshot'

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

/** Старый JSON ещё может содержать alias вместо числового внешнего ключа. */
const LEGACY_ACTOR_DATABASE = new Map<string, unknown[]>([
  ['categories', [{ id: 4, alias: 'planet', name: 'Planet' }]],
  ['actors', [{ id: 10, categoryId: 'planet', parentId: null, name: 'Legacy world', description: '', color: '#fff' }]],
  ['physicalObjects', [{
    id: 1, actorId: 10, parentId: null, mass: 1, radius: 1, axialTilt: 0, rotationPeriod: 1, temperature: 0
  }]]
])

function LegacyActorEditor() {
  editor = useEditorDraft(LEGACY_ACTOR_DATABASE, [])
  return <TablePanel spec={actorsSpec} editor={editor} />
}

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
  it('blocks same-tick saving of a reparented scenario root and saves its restoration', async () => {
    const { Scenarios } = await import('@/config/scenarios')
    const database = new Map<string, unknown[]>(Object.entries(await shippedSnapshot()))
    function ScenarioEditor(): null {
      editor = useEditorDraft(database, Scenarios)
      return null
    }
    act(() => root.render(<ScenarioEditor />))
    saveSpy.mockResolvedValue({ ok: true, written: [] })
    const actor = editor.draft.actors.find(row => row.id === 1)!
    const save = editor.save

    await act(async () => {
      editor.upsert('actors', { ...actor, parentId: 42 })
      await save()
    })
    expect(saveSpy).not.toHaveBeenCalled()
    expect(editor.validation.errors).toContainEqual(expect.objectContaining({
      collection: 'actors', entity: 1, message: expect.stringMatching(/scenario.*root.*parentId/)
    }))
    expect(editor.saveStatus).toContain('Cannot save:')

    await act(async () => {
      editor.upsert('actors', actor)
      await save()
    })
    expect(editor.validation.ok).toBe(true)
    expect(saveSpy).toHaveBeenCalledOnce()
    expect(editor.saveStatus).toContain('Saved')
  })

  it.each([39, 47, 109, 127])('блокирует сохранение после удаления обязательного renderingObject актора %s и разрешает после восстановления', async (actorId) => {
    const snapshot = await shippedSnapshot()
    const database = new Map<string, unknown[]>(Object.entries(snapshot))
    function RenderingEditor(): null {
      editor = useEditorDraft(database, [])
      return null
    }
    act(() => root.render(<RenderingEditor />))
    saveSpy.mockResolvedValue({ ok: true, written: [] })
    const rendering = editor.draft.renderingObjects.find((row) => row.actorId === actorId)!
    const save = editor.save

    await act(async () => {
      editor.remove('renderingObjects', rendering.id)
      await save()
    })

    expect(saveSpy).not.toHaveBeenCalled()
    expect(editor.saveStatus).toContain('Cannot save:')
    expect(editor.validation.ok).toBe(false)
    expect(editor.validation.errors).toContainEqual(expect.objectContaining({
      entity: actorId, message: expect.stringContaining('no renderingObject')
    }))

    await act(async () => {
      editor.upsert('renderingObjects', rendering)
      await save()
    })

    expect(editor.validation.ok).toBe(true)
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(editor.saveStatus).toContain('Saved')
    const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
    expect(files.find((file) => file.path.endsWith('/renderingObjects.ts'))!.content).toContain(`actorId: ${actorId},`)
  })

  it('кнопка сохранения недоступна после удаления настроек кольца через форму', () => {
    act(() => root.render(<DataEditorModal visible onClose={() => {}} />))
    const saveButton = (): HTMLButtonElement => Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save to generated')!
    expect(saveButton().disabled).toBe(false)
    const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-tab'))
      .find((button) => button.textContent?.startsWith('Rendering'))!
    act(() => tab.click())
    const ring = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-editor-row'))
      .find((button) => button.textContent?.startsWith('#9 '))!
    act(() => ring.click())
    click('Delete')

    expect(saveButton().disabled).toBe(true)
    expect(container.textContent).toContain('error(s) — cannot save')
  })

  it('сохраняет название категории, но не позволяет создать, удалить или сменить встроенный тип', async () => {
    saveSpy.mockResolvedValue({ ok: true, written: [] })
    act(() => root.render(<DataEditorModal visible onClose={() => {}} />))
    const categoryTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-tab'))
      .find((button) => button.textContent?.startsWith('Categories'))!
    act(() => categoryTab.click())
    const planetRow = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-editor-row'))
      .find((button) => button.textContent === '#4 Planet')!
    act(() => planetRow.click())
    const buttons = Array.from(container.querySelectorAll('button')).map((button) => button.textContent)
    expect(buttons).not.toContain('+ New')
    expect(buttons).not.toContain('Delete')
    const field = (name: string): HTMLInputElement => Array.from(container.querySelectorAll('label'))
      .find((label) => label.querySelector('.titan-field-label')?.textContent === name)!.querySelector('input')!
    expect(field('ID').disabled).toBe(true)
    expect(field('Alias').disabled).toBe(true)
    expect(field('Alias').value).toBe('planet')
    const name = field('Name')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Worlds')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => click('Save to generated'))

    expect(saveSpy).toHaveBeenCalledTimes(1)
    const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
    expect(files.find((file) => file.path.endsWith('/categories.ts'))!.content)
      .toContain('id: 4, alias: "planet", name: "Worlds"')
  })

  it('блокирует сохранение в том же тике после удаления физической записи и разрешает его после восстановления', async () => {
    const snapshot = await shippedSnapshot()
    const database = new Map<string, unknown[]>(Object.entries(snapshot))
    function PhysicalEditor(): null {
      editor = useEditorDraft(database, [])
      return null
    }
    act(() => root.render(<PhysicalEditor />))
    saveSpy.mockResolvedValue({ ok: true, written: [] })
    expect(editor.validation.ok).toBe(true)
    const physical = editor.draft.physicalObjects.find((row) => row.actorId === 5)!
    const save = editor.save

    await act(async () => {
      editor.remove('physicalObjects', physical.id)
      await save()
    })

    expect(saveSpy).not.toHaveBeenCalled()
    expect(editor.saveStatus).toContain('Cannot save:')
    expect(editor.validation.ok).toBe(false)
    expect(editor.validation.errors).toContainEqual(expect.objectContaining({
      entity: 5, message: expect.stringContaining('no physicalObject')
    }))

    await act(async () => {
      editor.upsert('physicalObjects', physical)
      await save()
    })

    expect(editor.validation.ok).toBe(true)
    expect(editor.saveStatus).toContain('Saved')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
    expect(files.find((file) => file.path.endsWith('/physicalObjects.ts'))!.content).toContain('actorId: 5,')
  })

  it('кнопка сохранения недоступна после удаления физических данных Меркурия через форму', () => {
    act(() => root.render(<DataEditorModal visible onClose={() => {}} />))
    const saveButton = (): HTMLButtonElement => Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save to generated')!
    expect(saveButton().disabled).toBe(false)
    const physicalTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-tab'))
      .find((button) => button.textContent?.startsWith('Physical'))!
    act(() => physicalTab.click())
    const mercury = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-editor-row'))
      .find((button) => button.textContent?.includes('Mercury'))!
    act(() => mercury.click())

    click('Delete')

    expect(saveButton().disabled).toBe(true)
    expect(container.textContent).toContain('error(s) — cannot save')
  })

  it('отклоняет старый alias и сохраняет числовой categoryId после выбора категории в форме', async () => {
    saveSpy.mockResolvedValue({ ok: true, written: [] })
    act(() => root.render(<LegacyActorEditor />))
    expect(editor.validation.ok).toBe(false)

    await act(async () => editor.save())
    expect(saveSpy).not.toHaveBeenCalled()
    expect(editor.saveStatus).toContain('Cannot save:')

    act(() => container.querySelector<HTMLButtonElement>('.titan-editor-row')!.click())
    const select = Array.from(container.querySelectorAll('label'))
      .find((label) => label.querySelector('.titan-field-label')?.textContent === 'Category')!
      .querySelector('select')!
    act(() => {
      select.value = '4'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(editor.draft.actors[0].categoryId).toBe(4)
    expect(editor.validation.ok).toBe(true)

    await act(async () => editor.save())
    expect(saveSpy).toHaveBeenCalledTimes(1)
    const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
    expect(files.find((file) => file.path.endsWith('/actors.ts'))!.content).toContain('categoryId: 4')
    expect(editor.saveStatus).toContain('Saved')
  })

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

it.each([
  { table: 'Rotation', field: 'Direction', key: 'direction', selected: '1', file: 'rotationObjects.ts' },
  { table: 'Placements', field: 'Lagrange point of parent orbit (empty = XYZ)', key: 'lagrange', selected: '4', file: 'placements.ts' }
])('clearing optional $key omits it from generated database rows', async ({ table, field, key, selected, file }) => {
  saveSpy.mockResolvedValue({ ok: true, written: [] })
  act(() => root.render(<DataEditorModal visible onClose={() => {}} />))
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-tab'))
    .find((button) => button.textContent?.startsWith(table))!
  act(() => tab.click())
  act(() => container.querySelector<HTMLButtonElement>('.titan-editor-row')!.click())
  const select = Array.from(container.querySelectorAll('label'))
    .find((label) => label.querySelector('.titan-field-label')?.textContent === field)!
    .querySelector('select')!
  expect(select.value).toBe(selected)

  act(() => {
    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

  const saveButton = Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent === 'Save to generated')!
  expect(select.value).toBe('')
  expect(saveButton.disabled).toBe(false)
  await act(async () => saveButton.click())

  const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
  const content = files.find((entry) => entry.path.endsWith(`/${file}`))!.content
  const editedRow = content.split('\n').find((line) => /^ {2}\{ id: 1,/.test(line))!
  expect(editedRow).toBeDefined()
  expect(editedRow).not.toContain(`${key}:`)
  // Clearing optional enums must not erase required nullable foreign keys.
  const actorContent = files.find((entry) => entry.path.endsWith('/actors.ts'))!.content
  expect(actorContent).toContain('parentId: null')
})

const JSON_DATABASE = new Map<string, unknown[]>([
  ['categories', [
    { id: 1, alias: 'barycenter', name: 'First', data: { seed: 1 } },
    { id: 2, alias: 'blackHole', name: 'Second', data: { seed: 2 } }
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

it.each(['{ invalid', '1', 'true', '"x"', '0', 'false', '""', '[]', 'null'])(
  'the real editor modal blocks invalid JSON %s and recovers after correction', (invalid) => {
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
  act(() => inputJson(invalid))
  expect(saveButton().disabled).toBe(true)
  expect(container.textContent).toContain('Invalid input — cannot save')
  switchTo('Actors')
  expect(saveButton().disabled).toBe(true)
  switchTo('Rendering')
  expect(container.querySelector('textarea')!.value).toBe(invalid)
  act(() => inputJson(original))
  expect(saveButton().disabled).toBe(false)
})

it('blocks saving an atmosphere without irradiance, then exports a config usable by the renderer', async () => {
  const initial = renderingDataTemplates.find((template) => template.value === 'atmosphere')!.data as Record<string, unknown>
  const database = new Map<string, unknown[]>([
    ['categories', [{ id: 5, alias: 'atmosphere', name: 'Atmosphere' }]],
    ['actors', [{ id: 1, categoryId: 5, parentId: null, name: 'Sky', color: '#ffffff', description: '' }]],
    ['renderingObjects', [{ id: 1, actorId: 1, data: initial }]]
  ])
  function AtmosphereEditor() {
    editor = useEditorDraft(database, [])
    return <TablePanel spec={renderingObjectsSpec} editor={editor} />
  }
  act(() => root.render(<AtmosphereEditor />))
  act(() => container.querySelector<HTMLElement>('.titan-editor-row')!.click())
  saveSpy.mockResolvedValue({ ok: true, written: [] })
  const edited = { ...initial }
  delete edited.solarIrradiance
  const save = editor.save
  await act(async () => { inputJson(JSON.stringify(edited)); await save() })
  expect(saveSpy).not.toHaveBeenCalled()
  expect(editor.saveStatus).toContain('Cannot save')
  expect(editor.validation.errors.some((e) => e.message.includes('solarIrradiance'))).toBe(true)
  expect(JSON.parse(container.querySelector('textarea')!.value)).toEqual(edited)

  await act(async () => { inputJson(JSON.stringify(initial)); await save() })
  expect(saveSpy).toHaveBeenCalledTimes(1)
  expect(editor.validation.errors).toEqual([])
  const files = saveSpy.mock.calls[0][0] as GeneratedFile[]
  expect(files.find((file) => file.path.includes('renderingObjects'))!.content).toContain('solarIrradiance:')
  const config = editor.draft.renderingObjects[0].data as unknown as AtmosphereConfig
  const uniforms = createAtmosphereUniforms(config)
  expect(uniforms.u_solar_irradiance.value.toArray()).toEqual(initial.solarIrradiance)
  expect(uniforms.u_sun_angular_radius.value).toBe(initial.sunAngularRadius)
})
it.each(['1', 'true', '"text"', '[]', 'null', '{"emission":1e400}', '{"nested":[-1e400]}'])(
  'the real editor keeps invalid rendering data %s editable and blocks saving it', async (text) => {
    act(() => root.render(<DataEditorModal visible onClose={() => {}} />))
    const rendering = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-tab'))
      .find((button) => button.textContent?.startsWith('Rendering'))!
    act(() => rendering.click())
    act(() => container.querySelector<HTMLElement>('.titan-list-item')!.click())
    const original = container.querySelector('textarea')!.value
    const saveButton = (): HTMLButtonElement => Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save to generated')!

    act(() => inputJson(text))

    expect(container.querySelector('textarea')!.value).toBe(text)
    expect(saveButton().disabled).toBe(true)
    await act(async () => saveButton().click())
    expect(saveSpy).not.toHaveBeenCalled()

    act(() => inputJson(original))
    expect(saveButton().disabled).toBe(false)
  }
)
