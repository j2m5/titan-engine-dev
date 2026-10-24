import { describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import { startEarthCloudSession } from '@/labs/earth-clouds/earthCloudSession'
import type { EarthTextures } from '@/labs/earth-clouds/earthAssets'
function setup() {
  const maps = [new Texture(), new Texture(), new Texture(), new Texture()]
  const disposals = maps.map(t => vi.spyOn(t, 'dispose'))
  const textures: EarthTextures = { surface: maps[0], clouds: maps[1], night: maps[2], specular: maps[3], dispose: vi.fn(() => maps.forEach(t => t.dispose())) }
  let resolve!: (t: EarthTextures) => void, reject!: (e: Error) => void
  const load = () => new Promise<EarthTextures>((yes, no) => { resolve = yes; reject = no })
  const lab = { dispose: vi.fn(() => textures.dispose()) }
  const create = vi.fn(() => lab), onReady = vi.fn(), onError = vi.fn()
  const session = startEarthCloudSession({ load, create, onReady, onError })
  return { textures, disposals, resolve, reject, lab, create, onReady, onError, session }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
describe('Earth session ownership', () => {
  it('releases all late maps exactly once without callbacks', async () => {
    const s = setup(); s.session.dispose(); s.resolve(s.textures); await flush(); s.session.dispose()
    expect(s.create).not.toHaveBeenCalled(); expect(s.onReady).not.toHaveBeenCalled()
    s.disposals.forEach(spy => expect(spy).toHaveBeenCalledTimes(1))
  })
  it('disposes a successfully created lab exactly once', async () => {
    const s = setup(); s.resolve(s.textures); await flush(); s.session.dispose(); s.session.dispose()
    expect(s.onReady).toHaveBeenCalledWith(s.lab); expect(s.lab.dispose).toHaveBeenCalledTimes(1)
  })
  it('reports loader rejection once', async () => {
    const s = setup(); s.reject(new Error('missing map')); await flush()
    expect(s.onError).toHaveBeenCalledOnce(); expect(s.create).not.toHaveBeenCalled()
  })
  it('leaves constructor failure cleanup to the constructor owner', async () => {
    const s = setup(); s.create.mockImplementation(() => { s.textures.dispose(); throw new Error('constructor') })
    s.resolve(s.textures); await flush(); s.session.dispose()
    s.disposals.forEach(spy => expect(spy).toHaveBeenCalledTimes(1)); expect(s.onError).toHaveBeenCalledOnce()
  })
  it('disposes the lab if onReady throws', async () => {
    const s = setup(); s.onReady.mockImplementation(() => { throw new Error('ready callback') })
    s.resolve(s.textures); await flush(); s.session.dispose()
    expect(s.lab.dispose).toHaveBeenCalledTimes(1); expect(s.onError).toHaveBeenCalledOnce()
  })
  it('suppresses rejection after disposal', async () => {
    const s = setup(); s.session.dispose(); s.reject(new Error('late')); await flush()
    expect(s.onError).not.toHaveBeenCalled()
  })
})
