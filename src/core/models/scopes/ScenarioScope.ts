import { Scope } from '@/core/framework/Memoquent/Scope'
import { IActor } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { QueryBuilder } from '@/core/framework/Memoquent/QueryBuilder'
import { scenarioContext } from '@/core/scenario/ScenarioContext'

class ScenarioScope implements Scope<IActor, Actor> {
  public apply(builder: QueryBuilder<IActor, Actor>): void {
    const rootId: number | undefined = scenarioContext.rootId

    if (!rootId) return

    const scenarioIds: number[] = Actor.where({ id: rootId }).expand().pluck('id')

    builder.whereIn('id', scenarioIds)
  }
}

export { ScenarioScope }
