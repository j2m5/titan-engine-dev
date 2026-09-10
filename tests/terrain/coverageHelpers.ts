import { Mesh, type Object3D } from 'three'
import {
  liveAncestorKey,
  TERRAIN_QUADTREE_MAX_LEVEL,
  terrainNodeKey,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'

/**
 * Общий стенд проверки покрытия кубосферы патчами — один на все тесты
 * квадродерева (TerrainSphere.spec, TerrainPatchGroupBudget.spec): инвариант
 * «без дыр» проверяется в обоих, а расхождение двух копий этих хелперов
 * означало бы, что один из тестов молча проверяет не то.
 *
 * Покрытие считается по МНОЖЕСТВУ АДРЕСОВ, а не по сумме площадей: ячейка
 * покрыта, если виден её собственный меш либо покрыты все четыре ребёнка
 * (рекурсивно до потолка). Сумма площадей дыру не ловила — перекрытие
 * родитель+дети в одном месте компенсировало дыру в другом.
 */

/** Патчи группы (меши с адресом в userData) — служебные дети сюда не попадают. */
export function patchMeshes(group: Object3D): Mesh[] {
  return group.children.filter(
    (c): c is Mesh => c instanceof Mesh && Boolean(c.userData.terrainAddress)
  )
}

export function addressOf(mesh: Mesh): TerrainNodeAddress {
  return mesh.userData.terrainAddress as TerrainNodeAddress
}

/** Ключи ВИДИМЫХ патчей — то, что реально рисуется в кадре. */
export function visibleAddressKeys(group: Object3D): Set<number> {
  const keys = new Set<number>()
  for (const mesh of patchMeshes(group)) {
    if (mesh.visible) keys.add(terrainNodeKey(addressOf(mesh)))
  }
  return keys
}

export function covered(keys: ReadonlySet<number>, face: number, level: number, i: number, j: number): boolean {
  if (keys.has(terrainNodeKey({ face, level, i, j }))) return true
  if (level >= TERRAIN_QUADTREE_MAX_LEVEL) return false
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      if (!covered(keys, face, level + 1, 2 * i + a, 2 * j + b)) return false
    }
  }
  return true
}

/** Вся кубосфера покрыта видимыми патчами (шесть граней, по четыре ячейки L1). */
export function fullyCovered(group: Object3D): boolean {
  const keys = visibleAddressKeys(group)
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        if (!covered(keys, face, 1, i, j)) return false
      }
    }
  }
  return true
}

/**
 * Скрытый патч не создаёт дыры: его место занимает ЛИБО видимый предок
 * (замена крупнее ещё не ушла), ЛИБО полностью видимые потомки. Возвращает
 * адреса скрытых патчей, для которых это НЕ выполняется — пустой массив
 * означает, что своп на этом кадре дыр не оставил.
 */
export function unbackedHiddenAddresses(group: Object3D): TerrainNodeAddress[] {
  const visible = visibleAddressKeys(group)
  const bad: TerrainNodeAddress[] = []
  for (const mesh of patchMeshes(group)) {
    if (mesh.visible) continue
    const a = addressOf(mesh)
    const ancestorVisible = liveAncestorKey(a, (k) => visible.has(k)) !== -1
    if (!ancestorVisible && !covered(visible, a.face, a.level, a.i, a.j)) bad.push(a)
  }
  return bad
}

/** Строгий потомок: та же грань, глубже, префикс адреса совпадает. */
export function isStrictDescendant(d: TerrainNodeAddress, a: TerrainNodeAddress): boolean {
  if (d.face !== a.face || d.level <= a.level) return false
  const delta = d.level - a.level
  return d.i >> delta === a.i && d.j >> delta === a.j
}
