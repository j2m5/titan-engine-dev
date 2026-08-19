import { describe, it, expect } from 'vitest'
import { Object3D, Scene } from 'three'
import '@/core/framework/TitanThree'
import { SceneObserver } from '@/core/services/SceneObserver'

describe('SceneObserver.refreshObservableObjects', () => {
  it('подхватывает поверхность, подменившую старую под тем же родителем', () => {
    const observer = new SceneObserver()
    const scene = new Scene()
    const parent = new Object3D()
    const oldSurface = new Object3D()

    oldSurface.userData.type = 'planet'
    parent.add(oldSurface)
    scene.add(parent)

    // Сеттер scene зовёт defineObservableObjects() один раз — снимок берёт
    // старую поверхность.
    observer.scene = scene

    expect(observer.objects).toContain(oldSurface)

    // Подмена «на лету», как её делает RenderableFactory.upgradePlanetToTerrain
    // (swapSurface): старая поверхность снимается с родителя, новая встаёт на
    // её место.
    parent.remove(oldSurface)
    const newSurface = new Object3D()

    newSurface.userData.type = 'planet'
    parent.add(newSurface)

    // Без пересбора снимок стух: держит открепившийся объект, а не новый.
    expect(observer.objects).toContain(oldSurface)
    expect(observer.objects).not.toContain(newSurface)

    observer.refreshObservableObjects()

    expect(observer.objects).toContain(newSurface)
    expect(observer.objects).not.toContain(oldSurface)
  })
})
