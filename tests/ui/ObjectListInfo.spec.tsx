import { act } from 'react'
import { runInAction } from 'mobx'
import { createRoot, type Root } from 'react-dom/client'
import type { ScenarioConfig } from '@/config/scenarios'
import { Group } from 'three'
import { Actor } from '@/core/models/Actor'
import { createObjectListFixture } from './objectListFixture'
import { engineStore } from '@/ui/mobx/EngineStore'
import { bodyInfoStore } from '@/ui/mobx/BodyInfoStore'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root
let fixture: ReturnType<typeof createObjectListFixture>
let target: Group

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Солнечная система: корень — барицентр (id 1)
  runInAction(() => {
    engineStore.scenario = { rootId: 1 } as ScenarioConfig
  })
  bodyInfoStore.connect({ measure: () => null })
  fixture = createObjectListFixture()
  const sun = Actor.find(4)!

  target = Object.assign(new Group(), { model: sun, name: sun.getAttribute('name', '') })
  fixture.scene.add(target)
  act(() => root.render(fixture.render()))
})

afterEach(() => {
  act(() => bodyInfoStore.close())
  act(() => root.unmount())
  container.remove()
  runInAction(() => {
    engineStore.scenario = null
  })
})

function infoButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[title="Info"], button[title="Hide info"]'))
}

describe('ObjectList: кнопка ⓘ', () => {
  it('открывает карточку тела строки, повторное нажатие закрывает', () => {
    act(() => infoButtons()[0].click())

    expect(bodyInfoStore.reference).not.toBeNull()
    expect(infoButtons()[0].title).toBe('Hide info')

    act(() => infoButtons()[0].click())

    expect(bodyInfoStore.reference).toBeNull()
  })

  it('не выбирает тело: клик не всплывает в строку списка (прицел не вешается)', () => {
    act(() => infoButtons()[0].click())

    expect(fixture.crosshair.parent).toBeNull()

    act(() => container.querySelector<HTMLElement>('.titan-list-item')!.click())
    expect(fixture.crosshair.parent).toBe(target)
  })
})
