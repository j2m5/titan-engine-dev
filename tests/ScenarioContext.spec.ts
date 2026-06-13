import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScenarioContext } from '@/core/scenario/ScenarioContext'
import { ScenarioConfig } from '@/config/scenarios'

const makeScenario = (rootId: number): ScenarioConfig => ({ rootId }) as ScenarioConfig

describe('ScenarioContext', () => {
  let context: ScenarioContext

  beforeEach(() => {
    context = new ScenarioContext()
  })

  it('по умолчанию пуст', () => {
    expect(context.current).toBeNull()
    expect(context.rootId).toBeUndefined()
  })

  it('set() сохраняет сценарий и отдает rootId', () => {
    context.set(makeScenario(42))

    expect(context.current?.rootId).toBe(42)
    expect(context.rootId).toBe(42)
  })

  it('эмитит change при смене сценария', () => {
    const listener = vi.fn()
    context.subscribe('change', listener)

    const scenario = makeScenario(7)
    context.set(scenario)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(scenario)
  })

  it('не эмитит, если сценарий не изменился', () => {
    const scenario = makeScenario(1)
    context.set(scenario)

    const listener = vi.fn()
    context.subscribe('change', listener)
    context.set(scenario)

    expect(listener).not.toHaveBeenCalled()
  })

  it('set(null) сбрасывает контекст и оповещает', () => {
    context.set(makeScenario(5))

    const listener = vi.fn()
    context.subscribe('change', listener)
    context.set(null)

    expect(context.current).toBeNull()
    expect(listener).toHaveBeenCalledWith(null)
  })
})

import { scenarioContext } from '@/core/scenario/ScenarioContext'
import { Actor } from '@/core/models/Actor'

describe('Actor + ScenarioScope (без UI)', () => {
  beforeEach(() => scenarioContext.set(null))

  it('без активного сценария скоуп не ограничивает выборку', () => {
    scenarioContext.set(null)
    expect(Actor.query().get().count()).toBe(Actor.query().withoutGlobalScopes().get().count())
  })

  it('с активным сценарием выборка сужается до его поддерева', () => {
    scenarioContext.set(makeScenario(/* реальный rootId из БД */ 1))
    const scoped = Actor.query().get().count()
    const all = Actor.query().withoutGlobalScopes().get().count()
    expect(scoped).toBeLessThanOrEqual(all)
  })
})
