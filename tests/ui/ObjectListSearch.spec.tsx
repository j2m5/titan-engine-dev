import { act } from 'react'
import { runInAction } from 'mobx'
import { createRoot, type Root } from 'react-dom/client'
import type { ScenarioConfig } from '@/config/scenarios'
import type { Actor } from '@/core/models/Actor'

const { target } = vi.hoisted(() => ({ target: { add: vi.fn() } }))

vi.mock('@/ui/hooks/useInjection', () => ({
  useInjection: () => ({ crosshair: {}, getObjectByName: () => target })
}))

import ObjectList from '@/ui/components/common/ObjectList'
import TitanModal from '@titanui/components/TitanModal'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'
import { engineStore } from '@/ui/mobx/EngineStore'

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
  // Солнечная система: корень — барицентр (id 1)
  runInAction(() => {
    engineStore.scenario = { rootId: 1 } as ScenarioConfig
  })
  act(() => root.render(<ObjectList />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  runInAction(() => {
    engineStore.scenario = null
  })
})

function field(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[aria-label="Search objects"]')!
}

/** Ввод в управляемое поле React: нативный сеттер value + событие input */
function type(text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

  act(() => {
    setter.call(field(), text)
    field().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(element: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })

  act(() => {
    element.dispatchEvent(event)
  })

  return event
}

/** Строки списка — по кнопкам «Fly to», по одной на строку */
function rowCount(): number {
  return container.querySelectorAll('button[title="Fly to"]').length
}

describe('ObjectList: поиск по объектам', () => {
  it('ввод сужает список до совпадений по имени', () => {
    const all = rowCount()

    type('mars')

    expect(all).toBeGreaterThan(1)
    expect(rowCount()).toBe(1)
    expect(container.textContent).toContain('Mars')
  })

  it('нет совпадений — строка «No matches»', () => {
    type('zzz')

    expect(rowCount()).toBe(0)
    expect(container.textContent).toContain('No matches')
  })

  it('Enter летит к первому совпадению, очищает поле и снимает с него фокус', () => {
    const execute = vi.spyOn(CameraToObjectTransition, 'execute').mockResolvedValue(undefined as never)

    act(() => field().focus())
    type('mars')
    press(field(), { key: 'Enter' })

    expect(execute).toHaveBeenCalledTimes(1)
    expect((execute.mock.calls[0][0] as { model: Actor }).model.getAttribute('name')).toBe('Mars')
    expect(field().value).toBe('')
    expect(document.activeElement).not.toBe(field())
  })

  it('Enter без совпадений ничего не делает', () => {
    const execute = vi.spyOn(CameraToObjectTransition, 'execute').mockResolvedValue(undefined as never)

    type('zzz')
    press(field(), { key: 'Enter' })

    expect(execute).not.toHaveBeenCalled()
  })

  it('«/» и Ctrl+K ставят фокус в поле; символ «/» в поле не попадает', () => {
    const slash = press(document.body, { key: '/', code: 'Slash' })

    expect(document.activeElement).toBe(field())
    expect(slash.defaultPrevented).toBe(true)

    act(() => field().blur())
    press(document.body, { key: 'k', code: 'KeyK', ctrlKey: true })

    expect(document.activeElement).toBe(field())
  })

  it('Ctrl+K в русской раскладке — по физической клавише', () => {
    press(document.body, { key: 'л', code: 'KeyK', ctrlKey: true })

    expect(document.activeElement).toBe(field())
  })

  it('горячая клавиша не перехватывает набор в другом поле', () => {
    const other = document.createElement('input')

    document.body.appendChild(other)
    other.focus()
    press(other, { key: '/', code: 'Slash' })

    expect(document.activeElement).toBe(other)
    other.remove()
  })

  it('горячая клавиша не работает, пока открыто окно', () => {
    act(() =>
      root.render(
        <>
          <ObjectList />
          <TitanModal visible={true} title="Settings" actions={null} onClose={() => {}}>
            settings
          </TitanModal>
        </>
      )
    )

    press(document.body, { key: '/', code: 'Slash' })

    expect(document.activeElement).not.toBe(field())
  })

  it('Escape: сначала очищает текст, затем снимает фокус', () => {
    act(() => field().focus())
    type('mars')

    press(field(), { key: 'Escape' })

    expect(field().value).toBe('')
    expect(document.activeElement).toBe(field())

    press(field(), { key: 'Escape' })

    expect(document.activeElement).not.toBe(field())
  })
})
