import { act } from 'react'
import { runInAction } from 'mobx'
import { createRoot, type Root } from 'react-dom/client'
import type { ScenarioConfig } from '@/config/scenarios'

// Сцена и менеджер сцены — один стаб: getObjectByName отдаёт цель с add,
// по которому видно, повесил ли кто-то прицел (handleSelect строки)
const { target } = vi.hoisted(() => ({ target: { add: vi.fn() } }))

vi.mock('@/ui/hooks/useInjection', () => ({
  useInjection: () => ({ crosshair: {}, getObjectByName: () => target })
}))

import ObjectList from '@/ui/components/common/ObjectList'
import { engineStore } from '@/ui/mobx/EngineStore'
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
  // Солнечная система: корень — барицентр (id 1)
  runInAction(() => {
    engineStore.scenario = { rootId: 1 } as ScenarioConfig
  })
  bodyInfoStore.connect({ measure: () => null })
  act(() => root.render(<ObjectList />))
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
    target.add.mockClear()

    act(() => infoButtons()[0].click())

    expect(target.add).not.toHaveBeenCalled()
  })
})
