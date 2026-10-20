import { expect, it, vi } from 'vitest'
import { Container } from '@/core/framework/container/Container'
import { Tokens } from '@/core/providers/tokens'
import { UiServiceProvider } from '@/ui/providers/UiServiceProvider'
import type { CameraController } from '@/core/camera/CameraController'
import type { CameraCollision } from '@/core/services/CameraCollision'
import type { BodyInfoService } from '@/core/bodyInfo/BodyInfoService'
import type { SimulationClock } from '@/core/time/SimulationClock'
import type { PerspectiveCamera } from 'three'

const stores = vi.hoisted(() => ({ time: vi.fn(), camera: vi.fn(), engine: vi.fn(), body: vi.fn() }))
vi.mock('@/ui/mobx/TimeStore', () => ({ timeStore: { connect: stores.time } }))
vi.mock('@/ui/mobx/CameraStore', () => ({ cameraStore: { connect: stores.camera } }))
vi.mock('@/ui/mobx/EngineStore', () => ({ engineStore: { connect: stores.engine } }))
vi.mock('@/ui/mobx/BodyInfoStore', () => ({ bodyInfoStore: { connect: stores.body } }))

it('resolves UI dependencies before subscriptions and does not reconnect completed stores', () => {
  const container = new Container()
  container.instance(Tokens.SimulationClock, {} as SimulationClock)
  container.instance(Tokens.CameraController, {} as CameraController)
  container.instance(Tokens.Camera, {} as PerspectiveCamera)
  container.instance(Tokens.CameraCollision, {} as CameraCollision)
  let fail = true
  container.singleton(Tokens.BodyInfoService, () => {
    if (fail) { fail = false; throw new Error('dependency unavailable') }
    return {} as BodyInfoService
  })
  const provider = new UiServiceProvider(container)
  expect(() => provider.boot()).toThrow('dependency unavailable')
  expect(stores.time).not.toHaveBeenCalled()
  expect(stores.camera).not.toHaveBeenCalled()
  provider.boot()
  provider.boot()
  for (const connect of Object.values(stores)) expect(connect).toHaveBeenCalledTimes(1)
})
