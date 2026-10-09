import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Mock } from 'vitest'
import { useDebounce } from '@/ui/hooks'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const DELAY = 500

let container: HTMLDivElement
let root: Root
let change: (value: string) => void = () => {}

function Host({ save }: { save: (value: string) => void }): ReactElement {
  const [value, onChange] = useDebounce('', DELAY, save)

  change = onChange

  return <span>{value}</span>
}

function render(save: Mock): void {
  act(() => root.render(<Host save={save} />))
}

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useDebounce: отложенное сохранение', () => {
  it('серия правок сохраняется один раз — последним значением после задержки', () => {
    const save = vi.fn()
    render(save)

    act(() => change('a'))
    act(() => change('ab'))
    act(() => vi.advanceTimersByTime(DELAY - 1))
    expect(save).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('ab')
  })

  it('размонтирование до задержки сохраняет отложенную правку сразу, а не после ухода компонента', () => {
    const save = vi.fn()
    render(save)

    act(() => change('x'))
    act(() => root.unmount())
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('x')

    vi.advanceTimersByTime(DELAY * 2)
    expect(save).toHaveBeenCalledTimes(1)

    root = createRoot(container)
  })

  it('без отложенной правки размонтирование ничего не сохраняет', () => {
    const save = vi.fn()
    render(save)

    act(() => change('y'))
    act(() => vi.advanceTimersByTime(DELAY))
    act(() => root.unmount())

    expect(save).toHaveBeenCalledTimes(1)
    root = createRoot(container)
  })

  it('смена функции сохранения: отложенная правка уходит в прежнюю', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(first)

    act(() => change('z'))
    render(second)
    act(() => vi.advanceTimersByTime(DELAY * 2))

    expect(first).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith('z')
    expect(second).not.toHaveBeenCalled()
  })
})
