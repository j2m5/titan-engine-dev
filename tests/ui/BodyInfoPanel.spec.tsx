import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Actor } from '@/core/models/Actor'
import BodyInfoPanel from '@/ui/components/common/bodyInfo/BodyInfoPanel'
import TitanModal from '@titanui/components/TitanModal'
import { bodyInfoStore } from '@/ui/mobx/BodyInfoStore'

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
  bodyInfoStore.connect({ measure: () => ({ distanceKm: 1000, starDistanceKm: 1.5e8, orbitalSpeedKms: 29.8 }) })
})

afterEach(() => {
  act(() => bodyInfoStore.close())
  act(() => root.unmount())
  container.remove()
})

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

describe('BodyInfoPanel', () => {
  it('закрытая карточка ничего не рисует', () => {
    act(() => root.render(<BodyInfoPanel />))

    expect(container.textContent).toBe('')
  })

  it('открытая: шапка, справка и живой блок', () => {
    act(() => root.render(<BodyInfoPanel />))
    act(() => bodyInfoStore.open(Actor.find(7)!))

    const text = container.textContent!

    expect(text).toContain('Earth')
    expect(text).toContain('Orbits Sun')
    expect(text).toContain('Surface gravity')
    expect(text).toContain('Distance')
    expect(text).toContain('1,000 km')
    expect(text).toContain('Orbital speed (rel. to Sun)')
  })

  it('крестик закрывает', () => {
    act(() => root.render(<BodyInfoPanel />))
    act(() => bodyInfoStore.open(Actor.find(7)!))

    act(() => container.querySelector<HTMLButtonElement>('button[title="Close"]')!.click())

    expect(bodyInfoStore.reference).toBeNull()
  })

  it('Escape без открытых окон закрывает карточку', () => {
    act(() => root.render(<BodyInfoPanel />))
    act(() => bodyInfoStore.open(Actor.find(7)!))

    pressEscape()

    expect(bodyInfoStore.reference).toBeNull()
  })

  it('Escape при открытом окне закрывает окно, карточка остаётся', () => {
    const onClose = vi.fn()

    act(() =>
      root.render(
        <>
          <BodyInfoPanel />
          <TitanModal visible={true} title="Settings" actions={null} onClose={onClose}>
            settings
          </TitanModal>
        </>
      )
    )
    act(() => bodyInfoStore.open(Actor.find(7)!))

    pressEscape()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(bodyInfoStore.reference).not.toBeNull()
  })
})
