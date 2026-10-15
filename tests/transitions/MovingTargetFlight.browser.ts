import '@/core/framework/TitanThree'
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three'
import { CameraToObjectTransition } from '@/core/transitions/CameraToObjectTransition'
import { CameraController } from '@/core/camera/CameraController'
import { SceneObserver } from '@/core/services/SceneObserver'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { Actor } from '@/core/models/Actor'
import type { AstroControls } from '@/core/libs/AstroControls'

export async function checkMovingTargetFlight(): Promise<unknown> {
  CameraToObjectTransition.cancelActive()
  const renderCamera = new PerspectiveCamera()
  const controller = new CameraController()
  controller.setSpeed(12345)
  const scene = new Scene()
  const target = new Object3D()
  target.userData.type = 'planet'
  target.position.set(0, 0, -10000)
  const model = {
    attributes: { name: 'Moving probe' },
    getAttribute: () => 'Moving probe',
    category: { getAttribute: () => 'planet' },
    physicalObject: { getAttribute: () => 100 }
  } as unknown as Actor
  target.model = model
  scene.add(target)
  const followed = new Object3D()
  scene.add(followed)
  controller.setFollowTarget(followed)
  const controls = {
    enabled: true,
    object: renderCamera,
    isOrbiting: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTarget: () => {}
  }
  const observer = new SceneObserver()
  observer.observable = controls as unknown as AstroControls
  observer.scene = scene
  observer.add({ name: 'Moving probe', data: { name: 'Moving probe', position: target.position.clone(), distance: 10000 } })
  let complete: (() => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const finished = new Promise<void>((resolve, reject) => {
    complete = resolve
    timeout = setTimeout(() => reject(new Error('Flight did not complete')), 12000)
  })
  const notifications: string[] = []
  const flight = new CameraToObjectTransition(observer, controller, {
    dispatch: notification => { notifications.push(notification.message); complete?.() }
  }, { close: () => {} }, renderCamera, controls as unknown as AstroControls)
  flight.model = model
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    await flight.handle()
    const followStoppedAtStart = controller.followTarget === null
    timers.push(setTimeout(() => { target.position.set(3000, 2000, -10000) }, 700))
    timers.push(setTimeout(() => { target.position.set(5000, -3000, -11000) }, 3500))
    await finished
    const position = target.getWorldPosition(new Vector3())
    const distance = renderCamera.position.distanceTo(position)
    const expectedDistance = toThreeJSUnits(100) * 3
    const aimCos = renderCamera.getWorldDirection(new Vector3()).dot(position.clone().sub(renderCamera.position).normalize())
    if (!followStoppedAtStart) throw new Error('Accepted flight did not stop positional follow')
    if (Math.abs(distance - expectedDistance) > expectedDistance * 0.01) {
      throw new Error(`Live target arrival distance ${distance}, expected ${expectedDistance}`)
    }
    if (aimCos < Math.cos(Math.PI / 180)) throw new Error(`Live target aim cosine ${aimCos}`)
    if (!controls.enabled || controller.speed !== 12345) throw new Error('Flight did not restore controls and speed')
    if (controller.followTarget !== null) throw new Error('Flight unexpectedly enabled follow at arrival')
    if (notifications.length !== 1) throw new Error('Flight must report success exactly once')
    return { followStoppedAtStart, distance, expectedDistance, aimCos, controlsEnabled: controls.enabled, speed: controller.speed, notifications }
  } finally {
    for (const timer of timers) clearTimeout(timer)
    clearTimeout(timeout)
    CameraToObjectTransition.cancelActive()
    observer.dispose()
  }
}
