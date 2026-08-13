import { Object3D, Vector3 } from 'three'

export type ModelStub = {
  physicalObject: { getAttribute: (key: string) => unknown } | null
}

/**
 * Заглушка модели ORM: `collectColliders` читает только
 * `model.physicalObject.getAttribute('radius')` (км).
 */
export function makeModel(radiusKm: number | null): ModelStub {
  return {
    physicalObject:
      radiusKm === null
        ? null
        : { getAttribute: (key: string): unknown => (key === 'radius' ? radiusKm : undefined) }
  }
}

/**
 * Тело с `userData.type` — полем, по которому SceneObserver собирает снапшот.
 * Явно переданная `model` нужна тестам на дедупликацию: две ноды одного актора
 * делят один экземпляр модели.
 */
export function makeBody(
  type: string,
  radiusKm: number | null,
  position: Vector3 = new Vector3(),
  model?: ModelStub
): Object3D {
  const body = new Object3D()

  body.userData.type = type
  body.position.copy(position)
  body.model = (model ?? makeModel(radiusKm)) as never

  return body
}
