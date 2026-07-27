import type { Material, Object3D } from 'three'
import { isDisposable } from '@/core/lifecycle/Disposable'

/** Узел, у которого могут быть геометрия и материал (Mesh, Line, Points, Sprite). */
type RenderNode = Object3D & {
  geometry?: { dispose?: () => void }
  material?: Material | Material[]
}

/**
 * Разбирает поддерево графа сцены.
 *
 * Граф — это дерево владения: узел владеет своей геометрией, своим материалом
 * и своими внеграфовыми ресурсами. Поэтому обход не отдельная бухгалтерия, а
 * способ опросить дерево владения.
 *
 * Порядок — снизу вверх: лист освобождается раньше владельца, потому что
 * владелец может в своём dispose() опираться на живых детей.
 */
export function disposeSceneTree(root: Object3D): void {
  const nodes: Object3D[] = []

  root.traverse((node: Object3D): void => {
    nodes.push(node)
  })

  for (let i = nodes.length - 1; i >= 0; i--) {
    const node: Object3D = nodes[i]

    if (isDisposable(node)) node.dispose()

    releaseRenderResources(node)
  }

  root.removeFromParent()
}

function releaseRenderResources(node: Object3D): void {
  const renderNode: RenderNode = node as RenderNode

  renderNode.geometry?.dispose?.()

  const material: Material | Material[] | undefined = renderNode.material

  if (Array.isArray(material)) {
    material.forEach(releaseMaterial)
  } else if (material) {
    releaseMaterial(material)
  }
}

/**
 * Освобождает только сам материал.
 *
 * По юниформам за текстурами НЕ ходим, хотя это каноничный рецепт из
 * туториалов three.js. Здесь он сломал бы приложение: в юниформах лежат
 * текстуры уровня приложения — например, общий шум аккреционного диска,
 * разделяемый всеми чёрными дырами. Текстуры освобождает их владелец:
 * `resourceStorage` глобально или конкретный класс в своём dispose().
 */
function releaseMaterial(material: Material): void {
  material.dispose()
}
