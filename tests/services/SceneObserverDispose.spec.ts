import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { SceneObserver } from '@/core/services/SceneObserver'
import { makeAstroControlsStub, makeSceneWithBody } from './sceneObserverStubs'

describe('SceneObserver.dispose', () => {
  it('не рвёт собственную подписку синглтона: после dispose() и повторного включения в сценарий data снова наполняется', () => {
    const observer = new SceneObserver()

    const firstControls = makeAstroControlsStub()
    observer.observable = firstControls
    observer.scene = makeSceneWithBody('planet')

    firstControls.dispatch(new Vector3(1, 2, 3))

    expect(observer.data.size).toBeGreaterThan(0)

    observer.dispose()

    expect(observer.data.size).toBe(0)

    const secondControls = makeAstroControlsStub()
    observer.observable = secondControls
    observer.scene = makeSceneWithBody('planet')

    secondControls.dispatch(new Vector3(4, 5, 6))

    expect(observer.data.size).toBeGreaterThan(0)
  })
})
