import { act, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import JsonField from '@/ui/editor/forms/JsonField'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root
let setFromOutside: (value: unknown) => void = () => {}

/** Родитель как GenericForm: значение из onChange возвращается пропом */
function Host({ initial }: { initial: unknown }): ReactElement {
  const [value, setValue] = useState<unknown>(initial)

  setFromOutside = setValue

  return <JsonField label="data" value={value} onChange={setValue} />
}

function textarea(): HTMLTextAreaElement {
  return container.querySelector('textarea')!
}

/** Ввод в управляемое поле React: нативный сеттер value + событие input */
function type(text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

  act(() => {
    setter.call(textarea(), text)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Host initial={{ seed: 1 }} />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('JsonField: ввод не переформатируется', () => {
  it('валидный JSON в своей записи остаётся как набран — без переформатирования и прыжка курсора', () => {
    type('{"seed": 2, "size":3}')

    expect(textarea().value).toBe('{"seed": 2, "size":3}')
  })

  it('незавершённый ввод остаётся как есть и показывает ошибку', () => {
    type('{"seed": ')

    expect(textarea().value).toBe('{"seed": ')
    expect(container.textContent).toContain('JSON error')
  })

  it('смена значения извне (другая запись) — текст форматируется заново', () => {
    act(() => setFromOutside({ size: 5 }))

    expect(textarea().value).toBe(JSON.stringify({ size: 5 }, null, 2))
  })
})
