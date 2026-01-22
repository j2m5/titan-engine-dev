import * as THREE from 'three'

/**
 * Здесь можно расширять классы Three.js, добавляя необходимые свойства и методы
 * после расширения нужно обязательно декларировать эти изменения в three-types.d.ts
 * @see @/core/framework/TitanThree/three-types.d.ts
 */

THREE.Object3D.prototype.model = null
THREE.Object3D.prototype.update = function (delta?: number): void {}
THREE.Mesh.prototype.resetMaterial = function (): void {}
