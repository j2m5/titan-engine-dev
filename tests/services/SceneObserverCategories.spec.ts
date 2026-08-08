import { describe, it, expect } from 'vitest'
import { Scene, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { OBSERVED_TYPES, SceneObserver } from '@/core/services/SceneObserver'
import { makeAstroControlsStub, makeSceneWithBody } from './sceneObserverStubs'

describe('SceneObserver: состав отслеживаемых типов', () => {
  it('ведёт коричневого карлика наравне со звездой и планетой', () => {
    // Сценарий Luhman 16 состоит из барицентра и карлика: если наблюдатель не
    // знает тип brownDwarf, отслеживать в нём становится нечего
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeSceneWithBody('brownDwarf', 'Luhman 16B')

    controls.dispatch(new Vector3(1, 2, 3))

    expect(observer.data.size).toBe(1)
    expect(observer.calculateClosestObject()?.name).toBe('Luhman 16B')
  })

  it('покрывает все навигационные категории списка объектов', () => {
    // CameraToObjectTransition.handle() начинается с getData(name) и молча
    // выходит, если записи нет. Категория, показанная в списке объектов, но
    // неизвестная наблюдателю, даёт мёртвую кнопку «лететь к» — поэтому
    // список типов ровно один на оба потребителя
    expect(OBSERVED_TYPES).toContain('planet')
    expect(OBSERVED_TYPES).toContain('star')
    expect(OBSERVED_TYPES).toContain('blackHole')
    expect(OBSERVED_TYPES).toContain('brownDwarf')
  })
})

describe('SceneObserver: сценарий без отслеживаемых тел', () => {
  it('не роняет кадр, а сообщает, что цели нет', () => {
    // reduce без начального значения на пустом массиве — исключение, и оно
    // повторяется каждый кадр, потому что onChange висит на update контролов
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = new Scene()

    expect(() => controls.dispatch(new Vector3(1, 2, 3))).not.toThrow()
    expect(observer.calculateClosestObject()).toBeNull()
    expect(controls.setTarget).not.toHaveBeenCalled()
  })
})
