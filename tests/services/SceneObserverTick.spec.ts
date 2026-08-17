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

    // дефолт интервала — 500 мс. Шаг тика ограничен клампом
    // MAX_TICK_DELTA_SECONDS (0.1 с) — накопление симулируем несколькими
    // кадрами, а не одним гигантским тиком, как раньше.
    for (let i = 0; i < 4; i += 1) observer.tick(0.1) // накоплено 400 мс
    expect(seen).toEqual([])

    observer.tick(0.1) // накоплено 500 мс
    expect(seen).toEqual(['Mars'])
  })

  it('накопитель обнуляется после срабатывания — второй пересчёт ждёт полный интервал', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeSceneWithBody('planet', 'Mars')

    const seen: string[] = []
    observer.subscribe('ClosestChange', (record: ObservableRecord): void => void seen.push(record.name))

    // Тот же кламп 0.1 с, что и в соседнем тесте — тики режем на кадровые
    // шаги вместо одного тика, перепрыгивающего интервал.
    for (let i = 0; i < 5; i += 1) observer.tick(0.1) // 500 мс — интервал пройден на пятом тике
    expect(seen).toHaveLength(1)

    observer.tick(0.1) // 100 мс с момента срабатывания
    expect(seen).toHaveLength(1)

    for (let i = 0; i < 4; i += 1) observer.tick(0.1) // ещё 400 мс — суммарно 500 мс
    expect(seen).toHaveLength(2)
  })

  it('тик без наблюдаемого не бросает', () => {
    // Сценарий не загружен или уже разобран (dispose обнуляет observable) —
    // кадровый цикл всё равно тикает.
    const observer = new SceneObserver()

    expect(() => observer.tick(10)).not.toThrow()
  })

  it('огромная дельта паузы загрузки не перепрыгивает интервал', () => {
    // renderClock не останавливается между сценариями: дельта первого кадра
    // нового сценария вбирает секунды. Без клампа тик выстрелил бы на ещё не
    // переставленной камере прошлого сценария.
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeSceneWithBody('planet', 'Mars')

    const seen: string[] = []
    observer.subscribe('ClosestChange', (record: ObservableRecord): void => void seen.push(record.name))

    observer.tick(10)

    expect(seen).toEqual([])
  })

  it('dispose обнуляет накопитель — новый сценарий начинает отсчёт с нуля', () => {
    const observer = new SceneObserver()
    const controls = makeAstroControlsStub()

    observer.observable = controls
    observer.scene = makeSceneWithBody('planet', 'Mars')

    const seen: string[] = []
    observer.subscribe('ClosestChange', (record: ObservableRecord): void => void seen.push(record.name))

    observer.tick(0.09) // накопили, но не выстрелили
    observer.dispose()

    observer.observable = controls
    observer.scene = makeSceneWithBody('planet', 'Mars')
    observer.tick(0.09) // если бы накопитель пережил dispose, здесь было бы 180 мс

    expect(seen).toEqual([])
  })
})
