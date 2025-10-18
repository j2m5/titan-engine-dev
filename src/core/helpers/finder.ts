import { Object3D } from 'three'

export function getObjectsByUserDataProperty(
  object: Object3D,
  key: string,
  value: any,
  result: Object3D[] = []
): Object3D[] {
  if (object.userData[key] === value) result.push(object)

  for (let i: number = 0; i < object.children.length; i++) {
    const child: Object3D = object.children[i]

    getObjectsByUserDataProperty(child, key, value, result)
  }

  return result
}
