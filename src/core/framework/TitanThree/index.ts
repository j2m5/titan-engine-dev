import * as THREE from 'three'

/**
 * Здесь можно расширять классы Three.js, добавляя необходимые свойства и методы
 * после расширения нужно обязательно декларировать эти изменения в three-types.d.ts
 * свойства и методы имеющие префикс "__" являются псевдо-приватными и не должны использоваться извне
 * @see @/core/framework/TitanThree/three-types.d.ts
 */

THREE.Object3D.prototype.model = null
THREE.Object3D.prototype.getObjectsByUserDataProperty = function (
  key: string,
  value: any,
  result: THREE.Object3D[] = []
): THREE.Object3D[] {
  if (this.userData[key] === value) result.push(this)

  for (let i: number = 0; i < this.children.length; i++) {
    this.children[i].getObjectsByUserDataProperty(key, value, result)
  }

  return result
}
THREE.Object3D.prototype.__setup = function (): void {}
THREE.Object3D.prototype.updateObject = function (): void {}
THREE.Mesh.prototype.resetMaterial = function (): void {}
