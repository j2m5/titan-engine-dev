import * as THREE from 'three'

/**
 * Здесь можно расширять классы Three.js, добавляя необходимые свойства и методы
 * после расширения нужно обязательно декларировать эти изменения в three-types.d.ts
 * свойства и методы имеющие префикс "__" являются псевдо-приватными и не должны использоваться извне
 * @see @/core/framework/TitanThree/three-types.d.ts
 */

THREE.Object3D.prototype.model = null
THREE.Object3D.prototype.getObjectsByUserDataProperty = function (
  object: THREE.Object3D,
  key: string,
  value: any,
  result: THREE.Object3D[] = []
): THREE.Object3D[] {
  if (object.userData[key] === value) result.push(object)

  for (let i: number = 0; i < object.children.length; i++) {
    const child: THREE.Object3D = object.children[i]

    this.getObjectsByUserDataProperty(child, key, value, result)
  }

  return result
}
THREE.Object3D.prototype.__setup = function (): void {}
THREE.Object3D.prototype.updateObject = function (delta?: number): void {}
THREE.Mesh.prototype.resetMaterial = function (): void {}
