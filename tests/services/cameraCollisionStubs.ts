import { Object3D, PerspectiveCamera, Vector3 } from 'three'
import type { SceneObserver } from '@/core/services/SceneObserver'
import { CameraCollision } from '@/core/services/CameraCollision'

export type ModelStub = {
  physicalObject: { getAttribute: (key: string) => unknown } | null
  resources: { where: (field: string, value: string) => { first: () => { getAttribute: (key: string) => unknown } | undefined } }
  renderingObject: { getAttribute: (key: string) => unknown } | null
}

/**
 * Заглушка модели ORM: `collectColliders` читает
 * `model.physicalObject.getAttribute('radius')` (км), для терраформных тел —
 * `model.resources.where('resourceType', 'height').first().getAttribute('path')`,
 * и, через `readRenderingData`, `model.renderingObject.getAttribute('data')`
 * (Task 5 water-foundation: `waterLevelMeters`). Отсутствие ручки — `renderingObject`
 * равен `null`, как у настоящего актора без строки в `renderingObjects`.
 */
export function makeModel(radiusKm: number | null, heightPath?: string, waterLevelMeters?: number): ModelStub {
  return {
    physicalObject:
      radiusKm === null
        ? null
        : { getAttribute: (key: string): unknown => (key === 'radius' ? radiusKm : undefined) },
    resources: {
      where: (_field: string, value: string) => ({
        first: () =>
          value === 'height' && heightPath !== undefined
            ? { getAttribute: (key: string): unknown => (key === 'path' ? heightPath : undefined) }
            : undefined
      })
    },
    renderingObject:
      waterLevelMeters === undefined
        ? null
        : { getAttribute: (key: string): unknown => (key === 'data' ? { waterLevelMeters } : undefined) }
  }
}

/**
 * Тело с `userData.type` — полем, по которому SceneObserver собирает снапшот.
 * Явно переданная `model` нужна тестам на дедупликацию: две ноды одного актора
 * делят один экземпляр модели (при явной `model` `heightPath`/`waterLevelMeters` игнорируются).
 */
export function makeBody(
  type: string,
  radiusKm: number | null,
  position: Vector3 = new Vector3(),
  model?: ModelStub,
  heightPath?: string,
  waterLevelMeters?: number
): Object3D {
  const body = new Object3D()

  body.userData.type = type
  body.position.copy(position)
  body.model = (model ?? makeModel(radiusKm, heightPath, waterLevelMeters)) as never

  return body
}

/**
 * Сервис с камерой и наблюдателем-заглушкой: CameraCollision читает у
 * SceneObserver только `objects`.
 */
export function makeCollision(
  objects: Object3D[],
  cameraPosition: Vector3
): { collision: CameraCollision; camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera()
  camera.position.copy(cameraPosition)

  const collision = new CameraCollision(camera, { objects } as unknown as SceneObserver)

  return { collision, camera }
}
