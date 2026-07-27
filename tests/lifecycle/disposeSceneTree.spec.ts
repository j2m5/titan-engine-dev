import { describe, it, expect, vi } from 'vitest'
import { Group, Mesh, Object3D, Sprite } from 'three'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'

/** Меш с подменёнными геометрией и материалом: настоящие GPU-ресурсы не нужны. */
function fakeMesh(name: string, material: { dispose: () => void }): Mesh {
  const mesh = new Mesh()
  mesh.name = name
  mesh.geometry = { dispose: vi.fn() } as unknown as Mesh['geometry']
  mesh.material = material as unknown as Mesh['material']

  return mesh
}

describe('disposeSceneTree', () => {
  it('освобождает геометрию и материал каждого узла поддерева', () => {
    const material = { dispose: vi.fn() }
    const root = new Group()
    const child = fakeMesh('child', material)
    root.add(child)

    disposeSceneTree(root)

    expect(child.geometry.dispose).toHaveBeenCalledTimes(1)
    expect(material.dispose).toHaveBeenCalledTimes(1)
  })

  it('зовёт dispose() у узлов, реализующих Disposable', () => {
    const spy = vi.fn()

    class DisposableNode extends Group {
      public dispose(): void {
        spy()
      }
    }

    const root = new Group()
    root.add(new DisposableNode())

    disposeSceneTree(root)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('идёт снизу вверх: лист освобождается раньше владельца', () => {
    const order: string[] = []

    class Recorder extends Group {
      public constructor(private readonly label: string) {
        super()
      }

      public dispose(): void {
        order.push(this.label)
      }
    }

    const owner = new Recorder('owner')
    const leaf = new Recorder('leaf')
    owner.add(leaf)

    disposeSceneTree(owner)

    expect(order).toEqual(['leaf', 'owner'])
  })

  it('терпит разделяемый материал: два меша, один материал', () => {
    const shared = { dispose: vi.fn() }
    const root = new Group()
    root.add(fakeMesh('a', shared), fakeMesh('b', shared))

    expect(() => disposeSceneTree(root)).not.toThrow()
    expect(shared.dispose).toHaveBeenCalledTimes(2)
  })

  it('НЕ ходит по юниформам материала за текстурами', () => {
    // Текстура шума чёрной дыры лежит в юниформах и живёт на всё приложение;
    // освобождать её обходом нельзя.
    const shared = { dispose: vi.fn() }
    const appScopedTexture = { dispose: vi.fn() }
    const material = { ...shared, uniforms: { uNoise: { value: appScopedTexture } } }
    const root = new Group()
    root.add(fakeMesh('bh', material))

    disposeSceneTree(root)

    expect(appScopedTexture.dispose).not.toHaveBeenCalled()
  })

  it('снимает корень с его родителя', () => {
    const scene = new Object3D()
    const root = new Group()
    scene.add(root)

    disposeSceneTree(root)

    expect(scene.children).toHaveLength(0)
  })

  it('не освобождает геометрию спрайта: она общая на весь three.js модуль, но освобождает его материал', () => {
    // Sprite в three.js 0.182 хранит геометрию в модульной переменной
    // `_geometry`, разделяемой всеми инстансами процесса. Освобождение по
    // обходу дерева — не её владелец.
    const sprite = new Sprite()
    sprite.geometry = { dispose: vi.fn() } as unknown as Sprite['geometry']
    sprite.material = { dispose: vi.fn() } as unknown as Sprite['material']

    const mesh = fakeMesh('sibling-mesh', { dispose: vi.fn() })

    const root = new Group()
    root.add(sprite, mesh)

    disposeSceneTree(root)

    expect(sprite.geometry.dispose).not.toHaveBeenCalled()
    expect(sprite.material.dispose).toHaveBeenCalledTimes(1)
    expect(mesh.geometry.dispose).toHaveBeenCalledTimes(1)
  })

  it('поддерживает массив материалов', () => {
    const first = { dispose: vi.fn() }
    const second = { dispose: vi.fn() }
    const mesh = new Mesh()
    mesh.geometry = { dispose: vi.fn() } as unknown as Mesh['geometry']
    mesh.material = [first, second] as unknown as Mesh['material']
    const root = new Group()
    root.add(mesh)

    disposeSceneTree(root)

    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })
})
