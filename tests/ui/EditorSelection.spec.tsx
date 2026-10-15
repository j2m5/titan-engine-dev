import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TablePanel } from '@/ui/editor/TablePanel'
import { useEditorDraft, type UseEditorDraft } from '@/ui/editor/useEditorDraft'
import type { TableSpec } from '@/ui/editor/forms/fieldSpec'
import TitanListItem from '@titanui/components/TitanListItem'

let container: HTMLDivElement
let root: Root
let editor: UseEditorDraft

const database = new Map<string, unknown[]>([
  ['actors', [{ id: 7, name: 'Only actor', categoryId: 1, parentId: null, description: '', color: '#ffffff' }]],
  ['categories', [{ id: 1, alias: 'star', name: 'First' }, { id: 2, alias: 'planet', name: 'Second' }]]
])
const spec: TableSpec = {
  table: 'categories', title: 'Categories', defaults: () => ({ name: 'New', actorId: null }),
  listLabel: (row) => String(row.name),
  fields: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'actorId', label: 'Actor', kind: 'select-fk', references: 'actors' },
    { key: 'optionalActorId', label: 'Optional actor', kind: 'select-fk', references: 'actors', nullable: true }
  ]
}

function Editor() {
  editor = useEditorDraft(database, [])
  return <TablePanel spec={spec} editor={editor} />
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Editor />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function selectOption(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it.each([null, undefined])('shows an empty required FK instead of the only actor for %s, then updates the draft', (actorId) => {
  act(() => editor.upsert('categories', { ...editor.draft.categories[0], actorId } as never))
  act(() => container.querySelector<HTMLElement>('.titan-list-item')!.click())
  const select = container.querySelector('select')!
  expect(select.value).toBe('')
  expect(select.selectedOptions[0].value).toBe('')
  expect(select.selectedOptions[0].textContent?.trim()).toBeTruthy()
  expect(select.closest('label')!.classList.contains('invalid')).toBe(true)

  selectOption(select, '7')
  expect((editor.draft.categories[0] as unknown as Record<string, unknown>).actorId).toBe(7)
  expect(select.value).toBe('7')
  expect(select.closest('label')!.classList.contains('invalid')).toBe(false)
})

it('keeps nullable FK empty and allows clearing a selected actor back to null', () => {
  act(() => container.querySelector<HTMLElement>('.titan-list-item')!.click())
  const select = container.querySelectorAll('select')[1]
  expect(select.value).toBe('')
  expect(select.selectedOptions[0].textContent).toContain('none')
  expect(select.closest('label')!.classList.contains('invalid')).toBe(false)
  selectOption(select, '7')
  selectOption(select, '')
  expect((editor.draft.categories[0] as unknown as Record<string, unknown>).optionalActorId).toBeNull()
})

it('provides tab-focusable native row buttons and selects records with Enter and Space', () => {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.titan-list-item'))
  for (const row of rows) {
    expect(row.tagName).toBe('BUTTON')
    expect((row as HTMLButtonElement).type).toBe('button')
    expect(row.tabIndex).toBe(0)
  }
  // jsdom does not perform Tab navigation or keyboard button activation defaults.
  // Focus the next tab stop, dispatch keys, and emulate only the native click default.
  for (const [index, key] of ['Enter', ' '].entries()) {
    const row = rows[index]
    act(() => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      row.focus()
    })
    expect(document.activeElement).toBe(row)
    expect(row.getAttribute('aria-pressed')).toBe('false')
    act(() => {
      const allowed = row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      if (key === 'Enter' && allowed) row.click()
      const released = row.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
      if (key === ' ' && allowed && released) row.click()
    })
    expect(container.querySelector('input')!.value).toBe(index === 0 ? 'First' : 'Second')
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(rows[1 - index].getAttribute('aria-pressed')).toBe('false')
  }
})

it('preserves shared list items containing nested controls as non-button containers', () => {
  act(() => root.render(<TitanListItem><button type="button">Nested action</button></TitanListItem>))
  const item = container.querySelector('.titan-list-item')!
  expect(item.tagName).toBe('DIV')
  expect(item.querySelector('button')!.textContent).toBe('Nested action')
  expect(container.querySelector('button button')).toBeNull()
})
