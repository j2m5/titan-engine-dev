import { Actor } from '@/core/models/Actor'
import { BodyInfoStore, bodyInfoStore } from '@/ui/mobx/BodyInfoStore'
import { engineStore } from '@/ui/mobx/EngineStore'

const LIVE = { distanceKm: 1, starDistanceKm: null, orbitalSpeedKms: null }

function connected() {
  const store = new BodyInfoStore()
  const measure = vi.fn((_actor: Actor) => LIVE)

  store.connect({ measure })

  return { store, measure }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('BodyInfoStore: опрос только пока карточка открыта', () => {
  it('открытие: справка, сразу замер, дальше раз в POLL_MS', () => {
    const { store, measure } = connected()

    store.toggle(Actor.find(7)!)

    expect(store.reference!.name).toBe('Earth')
    expect(store.live).toEqual(LIVE)
    expect(measure).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(BodyInfoStore.POLL_MS * 2)

    expect(measure).toHaveBeenCalledTimes(3)
  })

  it('повторный toggle того же тела закрывает и останавливает опрос', () => {
    const { store, measure } = connected()
    const earth = Actor.find(7)!

    store.toggle(earth)
    store.toggle(Actor.find(7)!)

    expect(store.reference).toBeNull()
    expect(store.live).toBeNull()

    vi.advanceTimersByTime(BodyInfoStore.POLL_MS * 4)

    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('другое тело при открытой карточке — замена, таймер по-прежнему один', () => {
    const { store, measure } = connected()

    store.toggle(Actor.find(7)!)
    store.toggle(Actor.find(8)!)

    expect(store.reference!.name).toBe('Mars')
    expect(measure).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(BodyInfoStore.POLL_MS)

    expect(measure).toHaveBeenCalledTimes(3)
    expect(measure.mock.calls.at(-1)![0].getAttribute('id')).toBe(8)
  })

  it('без подключённого сервиса — справка есть, живых величин нет, не падает', () => {
    const store = new BodyInfoStore()

    store.toggle(Actor.find(7)!)

    expect(store.reference).not.toBeNull()
    expect(store.live).toBeNull()
    store.close()
  })

  it('выход в меню закрывает карточку', async () => {
    bodyInfoStore.connect({ measure: vi.fn(() => LIVE) })
    bodyInfoStore.toggle(Actor.find(7)!)

    await engineStore.setScenario(null)

    expect(bodyInfoStore.reference).toBeNull()
  })
})
