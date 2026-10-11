import { CubeTexture, Scene } from 'three'
import { Application } from '@/Application'
import { Scenarios } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { Engine } from '@/core/Engine'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { instanceAttributeBytes } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorBudget'
import { instancePoolCapacities } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import type { Actor } from '@/core/models/Actor'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const texture = deferred(), prepare = deferred(), order: string[] = []
  const engine = { dispose: vi.fn(() => order.push('dispose')), initialize: vi.fn(() => order.push('initialize')), start: vi.fn(() => order.push('start')) }
  const observer = { scenario: null, sceneBackground: new CubeTexture(), loadPrimaryTextures: vi.fn(() => { order.push('textures'); return texture.promise }) }
  const impostors = { clear: vi.fn(() => order.push('clear')), prepareInitial: vi.fn(() => { order.push('prepare'); return prepare.promise }) }
  const detector = { record: vi.fn(() => { order.push('leaks'); return null }) }, gate = { clearNodeCache: vi.fn(), recompute: vi.fn() }
  const app = new Application(engine as unknown as Engine, observer as unknown as ResourceObserver, new Scene(), detector as never, gate as never,
    undefined, undefined, undefined, undefined, undefined, undefined, impostors)
  return { app, engine, observer, impostors, texture, prepare, order }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('Запуск со сценовыми импосторами', () => {
  beforeEach(() => { vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it('ждёт текстуры, initialize и prepare; start только после подготовки', async () => {
    const s = setup(), pending = s.app.run(Scenarios[0])
    expect(s.engine.initialize).not.toHaveBeenCalled()
    s.texture.resolve(); await tick()
    expect(s.order).toEqual(['dispose', 'clear', 'textures', 'initialize', 'prepare'])
    expect(s.engine.start).not.toHaveBeenCalled()
    s.prepare.resolve(); await pending
    expect(s.engine.initialize).toHaveBeenCalledTimes(1)
    expect(s.engine.start).toHaveBeenCalledTimes(1)
    s.app.teardown()
    expect(s.order.slice(-3)).toEqual(['dispose', 'clear', 'leaks'])
  })

  it.each(['textures', 'prepare'])('teardown во время %s не запускает устаревшую сцену', async stage => {
    const s = setup(), pending = s.app.run(Scenarios[0])
    if (stage === 'prepare') { s.texture.resolve(); await tick() }
    s.app.teardown(); s.texture.resolve(); s.prepare.resolve(); await pending
    expect(s.engine.start).not.toHaveBeenCalled()
    if (stage === 'textures') expect(s.engine.initialize).not.toHaveBeenCalled()
  })

  it('дескриптор не зависит от размера, резерв соответствует реальным capacities', () => {
    const actor = { getAttribute: () => 42, renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) } } as unknown as Actor
    const cfg = AsteroidRingSystem.resolveConfig(actor)
    const first = AsteroidRingSystem.describeImpostors(actor, { asteroidSizeKm: 3 })
    const second = AsteroidRingSystem.describeImpostors(actor, { asteroidSizeKm: 300 })
    expect(first.source).toEqual(second.source)
    expect(first.instanceBytes).toBe(instanceAttributeBytes(instancePoolCapacities(cfg.maxL0Instances, cfg.maxL0NearInstances, cfg.maxL1Instances, cfg.archetypeCount)))
  })
})
