import { act } from 'react'
import { runInAction } from 'mobx'
import { createRoot, type Root } from 'react-dom/client'
import { Group, Vector3 } from 'three'
import { database } from '@/config/database'
import type { ScenarioConfig } from '@/config/scenarios'
import { CameraController } from '@/core/camera/CameraController'
import { Actor } from '@/core/models/Actor'
import { cameraStore } from '@/ui/mobx/CameraStore'
import { engineStore } from '@/ui/mobx/EngineStore'
import { createObjectListFixture } from './objectListFixture'

let container: HTMLDivElement
let root: Root
let fixture: ReturnType<typeof createObjectListFixture>
let controller: CameraController
let originalActors: unknown
let first: Group
let second: Group

function nodeFor(actor: Actor): Group {
  return Object.assign(new Group(), { model: actor, name: actor.getAttribute('name', '') })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  originalActors = database.get('actors')
  const earth = Actor.find(7)!
  const actors = [7001, 7002].map((id) => new Actor({ ...earth.attributes, id, parentId: 7000, name: 'Twin' }))

  database.set('actors', actors.map((actor) => actor.toJSON()))
  runInAction(() => {
    engineStore.scenario = { rootId: 7000 } as ScenarioConfig
  })
  fixture = createObjectListFixture()
  first = nodeFor(actors[0])
  second = nodeFor(actors[1])
  // Scene order deliberately differs from row order.
  fixture.scene.add(second, first)
  controller = new CameraController()
  cameraStore.connect(controller)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(fixture.render()))
})

afterEach(() => {
  act(() => root.unmount())
  controller.stopFollowing()
  container.remove()
  database.set('actors', originalActors)
  runInAction(() => {
    engineStore.scenario = null
  })
})

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.titan-list-item'))
}

function follow(index: number): HTMLButtonElement {
  return rows()[index].querySelector<HTMLButtonElement>('button[title="Follow"], button[title="Stop following"]')!
}

describe('ObjectList actor identity', () => {
  it('selects each namesake by ID regardless of scene order', () => {
    expect(rows()).toHaveLength(2)
    act(() => rows()[0].click())
    expect(fixture.crosshair.parent).toBe(first)

    act(() => rows()[1].click())
    expect(fixture.crosshair.parent).toBe(second)
  })

  it('follows the requested namesake and marks only its row, switching and stopping normally', () => {
    act(() => follow(0).click())
    expect(controller.followTarget).toBe(first)
    expect(follow(0).title).toBe('Stop following')
    expect(follow(1).title).toBe('Follow')

    act(() => follow(1).click())
    expect(controller.followTarget).toBe(second)
    expect(follow(0).title).toBe('Follow')
    expect(follow(1).title).toBe('Stop following')

    act(() => follow(1).click())
    expect(controller.followTarget).toBeNull()
    expect(follow(0).title).toBe('Follow')
    expect(follow(1).title).toBe('Follow')
  })

  it('resolves renamed nodes and ignores an unrelated helper with the displayed name', () => {
    const helper = new Group()

    first.name = 'Renamed scene node'
    first.model = new Actor({ ...first.model!.attributes, name: 'Renamed model instance' })
    second.name = 'Another renamed node'
    helper.name = 'Twin'
    fixture.scene.add(helper)

    act(() => rows()[0].click())
    expect(fixture.crosshair.parent).toBe(first)
    act(() => follow(0).click())
    expect(controller.followTarget).toBe(first)
    expect(follow(0).title).toBe('Stop following')
    expect(follow(1).title).toBe('Follow')
  })

  it('ignores a missing actor and resolves its replacement on the next action', () => {
    fixture.scene.remove(first)
    act(() => follow(0).click())
    expect(controller.followTarget).toBeNull()
    expect(fixture.crosshair.parent).toBeNull()

    const replacement = nodeFor(new Actor({ ...first.model!.attributes }))

    fixture.scene.add(replacement)
    act(() => follow(0).click())
    expect(controller.followTarget).toBe(replacement)
    expect(fixture.crosshair.parent).toBe(replacement)

    fixture.scene.remove(replacement)
    const next = nodeFor(new Actor({ ...replacement.model!.attributes }))

    fixture.scene.add(next)
    act(() => follow(0).click())
    expect(controller.followTarget).toBe(next)
    expect(fixture.crosshair.parent).toBe(next)
    expect(replacement.children).not.toContain(fixture.crosshair)
  })

  it('keeps selection and follow on the body node when its renderable surface is replaced', () => {
    const frame = new Group()
    const surface = nodeFor(new Actor({ ...first.model!.attributes }))

    first.position.set(10, 20, 30)
    surface.position.set(100, 200, 300)
    first.add(frame)
    frame.add(surface)
    act(() => follow(0).click())
    expect(controller.followTarget).toBe(first)
    expect(fixture.crosshair.parent).toBe(first)

    frame.remove(surface)
    frame.add(nodeFor(new Actor({ ...first.model!.attributes })))
    first.position.x += 5
    frame.rotation.z += 1
    const cameraPosition = new Vector3()

    controller.updateFollow(cameraPosition)
    expect(cameraPosition.toArray()).toEqual([5, 0, 0])
    expect(fixture.crosshair.parent).toBe(first)
    act(() => follow(0).click())
    expect(controller.followTarget).toBeNull()
  })
})
