import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import TitanInput from '@titanui/components/TitanInput'

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

describe('TitanInput: ref, клавиши и имя для диктора', () => {
  it('inputRef указывает на сам input — в него можно поставить фокус', () => {
    const ref = createRef<HTMLInputElement>()

    act(() => root.render(<TitanInput value="" inputRef={ref} onChange={() => {}} />))

    expect(ref.current).toBe(container.querySelector('input'))
  })

  it('onKeyDown получает нажатия в поле, ariaLabel — имя поля', () => {
    const onKeyDown = vi.fn()

    act(() => root.render(<TitanInput value="" ariaLabel="Search objects" onKeyDown={onKeyDown} onChange={() => {}} />))

    const input = container.querySelector('input')!

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(input.getAttribute('aria-label')).toBe('Search objects')
  })
})
