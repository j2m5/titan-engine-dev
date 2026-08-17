import { describe, expect, it } from 'vitest'
import '@/core/framework/TitanThree'
import { SceneObserver, type ObservableRecord } from '@/core/services/SceneObserver'
import { makeAstroControlsStub, makeSceneWithBody } from './sceneObserverStubs'

/**
 * Тик — второй повод пересчитать дистанции, кроме движения камеры. Событие
 * `change` возникает только когда движется камера, а тела движутся по орбитам
 * сами: при неподвижной камере подходящее тело не становилось кандидатом
 * стриминга никогда.
 */
describe('SceneObserver: периодический пересчёт', () => {
  it('молчит до истечения интервала и эмитит после', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeSceneWithBody('planet', 'Mars')

    const seen: string[] = []
    observer.subscribe('ClosestChange', (record: ObservableRecord): void => void seen.push(record.name))

    // дефолт интервала — 500 мс
    observer.tick(0.2)
    expect(seen).toEqual([])

    observer.tick(0.4) // накоплено 600 мс
    expect(seen).toEqual(['Mars'])
  })

  it('накопитель обнуляется после срабатывания — второй пересчёт ждёт полный интервал', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeSceneWithBody('planet', 'Mars')

    const seen: string[] = []
    observer.subscribe('ClosestChange', (record: ObservableRecord): void => void seen.push(record.name))

    observer.tick(0.6)
    expect(seen).toHaveLength(1)

    observer.tick(0.2)
    expect(seen).toHaveLength(1)

    observer.tick(0.4)
    expect(seen).toHaveLength(2)
  })

  it('тик без наблюдаемого не бросает', () => {
    // Сценарий не загружен или уже разобран (dispose обнуляет observable) —
    // кадровый цикл всё равно тикает.
    const observer = new SceneObserver()

    expect(() => observer.tick(10)).not.toThrow()
  })
})
