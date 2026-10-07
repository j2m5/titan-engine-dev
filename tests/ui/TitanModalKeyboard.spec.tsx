import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import TitanModal from '@titanui/components/TitanModal'
import TitanButton from '@titanui/components/TitanButton'
import TitanIconButton from '@titanui/components/TitanIconButton'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(node: ReactNode): void {
  act(() => {
    root.render(node)
  })
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })

  act(() => {
    target.dispatchEvent(event)
  })

  return event
}

function modal(
  title: string,
  visible: boolean,
  onClose: () => void,
  body: ReactNode = <button>inside</button>
): ReactNode {
  return (
    <TitanModal title={title} visible={visible} onClose={onClose} actions={<button>Close</button>}>
      {body}
    </TitanModal>
  )
}

describe('TitanModal: Escape', () => {
  it('закрывает только верхнее из двух открытых окон', () => {
    const closeSettings = vi.fn()
    const closeTutorial = vi.fn()

    render(
      <>
        {modal('Settings', true, closeSettings)}
        {modal('Tutorial', true, closeTutorial)}
      </>
    )
    press('Escape')

    expect(closeTutorial).toHaveBeenCalledTimes(1)
    expect(closeSettings).not.toHaveBeenCalled()
  })

  it('из поля ввода не закрывает: Escape в редакторе не теряет правку', () => {
    const onClose = vi.fn()

    render(modal('Editor', true, onClose, <input data-testid="field" />))
    const field = container.querySelector('input')!

    field.focus()
    press('Escape', {}, field)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('закрытое окно на Escape не реагирует', () => {
    const onClose = vi.fn()

    render(modal('Hidden', false, onClose))
    press('Escape')

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TitanModal: фокус', () => {
  it('при открытии уходит в окно, после закрытия возвращается на кнопку, что его открыла', () => {
    const opener = document.createElement('button')

    document.body.appendChild(opener)
    opener.focus()

    render(modal('Help', true, () => {}))
    expect(container.querySelector('.titan-modal')!.contains(document.activeElement)).toBe(true)

    render(modal('Help', false, () => {}))
    expect(document.activeElement).toBe(opener)

    opener.remove()
  })

  it('Tab с последнего элемента — на первый, Shift+Tab с первого — на последний', () => {
    render(
      modal(
        'Trap',
        true,
        () => {},
        <>
          <button id="first">first</button>
          <button id="middle">middle</button>
        </>
      )
    )
    const buttons = Array.from(container.querySelectorAll('button'))
    const first = buttons[0]
    const last = buttons[buttons.length - 1]

    last.focus()
    const tab = press('Tab', {}, last)

    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    press('Tab', { shiftKey: true }, first)

    expect(document.activeElement).toBe(last)
  })

  it('скрытые элементы (display: none) в обход не попадают', () => {
    render(
      modal(
        'Player',
        true,
        () => {},
        <>
          <button id="add">Add a track</button>
          <input type="file" style={{ display: 'none' }} />
        </>
      )
    )
    const add = container.querySelector<HTMLButtonElement>('#add')!
    const close = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Close')!

    // последний видимый — Close в actions; с него Tab уходит на первый, а не в скрытый инпут
    close.focus()
    press('Tab', {}, close)

    expect(document.activeElement).toBe(add)
  })
})

describe('подсказки и имена кнопок', () => {
  it('TitanIconButton передаёт title — подсказка и имя для экранного диктора', () => {
    expect(renderToStaticMarkup(<TitanIconButton title="Fly to">x</TitanIconButton>)).toContain('title="Fly to"')
  })

  it('TitanButton передаёт aria-label', () => {
    expect(renderToStaticMarkup(<TitanButton ariaLabel="Run Solar system">Run</TitanButton>)).toContain(
      'aria-label="Run Solar system"'
    )
  })
})
