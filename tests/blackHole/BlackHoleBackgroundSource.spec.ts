import { BufferGeometry, Camera, CubeTexture, Group, Material, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { BlackHole } from '@/core/renderables/BlackHole'
import { Actor } from '@/core/models/Actor'
import { ResourceObserver } from '@/core/services/ResourceObserver'

/**
 * Мышиный actor: BlackHoleParameters читает только physicalObject.mass и
 * несколько опциональных атрибутов (см. tests/star/StarOuterLayerWiring.spec.ts
 * для того же приёма) — полный ORM-актор с БД тут не нужен.
 */
function stubActor(): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'mass' ? 8.54e36 : def)
    },
    renderingObject: null,
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'Sagittarius A*' : def)
  } as unknown as Actor
}

/**
 * Заглушка ResourceObserver с изменяемым sceneBackground — реальный класс
 * тянет за собой SceneObserver/TextureProvider/бюджет стриминга, которых тут
 * не нужно поднимать: BlackHole трогает только геттер sceneBackground.
 */
function stubResourceObserver(): ResourceObserver & { setBackground: (t: CubeTexture | null) => void } {
  let current: CubeTexture | null = null

  return {
    setBackground: (t: CubeTexture | null): void => {
      current = t
    },
    get sceneBackground(): CubeTexture | null {
      return current
    }
  } as unknown as ResourceObserver & { setBackground: (t: CubeTexture | null) => void }
}

function fireOnBeforeRender(blackHole: BlackHole, camera: Camera): void {
  // Сигнатура Object3D.onBeforeRender требует все шесть аргументов; сцена,
  // геометрия, материал и группа самим коллбэком BlackHole не используются
  blackHole.onBeforeRender(
    {} as WebGLRenderer,
    {} as Scene,
    camera,
    {} as BufferGeometry,
    {} as Material,
    {} as Group
  )
}

describe('BlackHole: источник фоновой кубмапы — ResourceObserver, не scene.background', () => {
  it('покадрово читает resourceObserver.sceneBackground, а не кэширует его в конструкторе', () => {
    const observer = stubResourceObserver()
    const blackHole = new BlackHole(stubActor(), observer)
    const camera = new PerspectiveCamera()
    const updateSpy = vi.spyOn(blackHole.material, 'update')

    const textureA = {} as CubeTexture
    observer.setBackground(textureA)
    fireOnBeforeRender(blackHole, camera)

    expect(updateSpy).toHaveBeenLastCalledWith(blackHole, camera, textureA, expect.any(Number))

    // Смена источника ПОСЛЕ конструирования дыры — сценарий сменился,
    // а BlackHole уже существует. Если бы текстура кэшировалась в
    // конструкторе, второй вызов всё ещё видел бы textureA
    const textureB = {} as CubeTexture
    observer.setBackground(textureB)
    fireOnBeforeRender(blackHole, camera)

    expect(updateSpy).toHaveBeenLastCalledWith(blackHole, camera, textureB, expect.any(Number))
  })

  it('null (фон ещё не загружен) не ломает обновление', () => {
    const observer = stubResourceObserver()
    const blackHole = new BlackHole(stubActor(), observer)
    const camera = new PerspectiveCamera()
    const updateSpy = vi.spyOn(blackHole.material, 'update')

    fireOnBeforeRender(blackHole, camera)

    expect(updateSpy).toHaveBeenLastCalledWith(blackHole, camera, null, expect.any(Number))
  })
})
