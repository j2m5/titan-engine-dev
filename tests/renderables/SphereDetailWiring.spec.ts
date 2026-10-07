import { describe, it, expect, vi } from 'vitest'
import { PerspectiveCamera, Scene, type Group, type Material, type Mesh, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { Star } from '@/core/renderables/Star'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShell } from '@/core/renderables/GiantStar/GiantStarShell'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import type { UpdateContext } from '@/core/UpdateContext'
import { stubGiantActor } from '../giantStar/stubGiantActor'

// Стабы — те же, что в tests/star/StarActivity.spec.ts, tests/brownDwarf/BrownDwarfBody.spec.ts,
// tests/whiteDwarf/WhiteDwarfProximityExposure.spec.ts
function starActor(): Actor {
  return {
    physicalObject: {
      getAttribute: (k: string, f: unknown = 0): unknown => (k === 'temperature' ? 5778 : k === 'radius' ? 696000 : f)
    },
    renderingObject: null,
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'name' ? 'S' : f)
  } as unknown as Actor
}

function brownDwarfActor(): Actor {
  return {
    getAttribute: (_key: string, def?: unknown): unknown => def ?? 'Dwarf',
    renderingObject: { getAttribute: () => ({ bandCount: 9 }) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def
    }
  } as unknown as Actor
}

function whiteDwarfActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'G29-38' : def),
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 8840 : key === 'temperature' ? 11820 : def
    }
  } as unknown as Actor
}

interface Case {
  name: string
  make: () => Mesh
  dense: number
}

const CASES: Case[] = [
  { name: 'Star', make: () => new Star(starActor()), dense: 256 },
  { name: 'BrownDwarf', make: () => new BrownDwarf(brownDwarfActor()), dense: 256 },
  { name: 'WhiteDwarf', make: () => new WhiteDwarf(whiteDwarfActor()), dense: 256 },
  { name: 'GiantStar', make: () => new GiantStar(stubGiantActor()), dense: 256 },
  { name: 'GiantStarShell', make: () => new GiantStarShell(new GiantStar(stubGiantActor())), dense: 128 }
]

/** Кадр с камерой на оси z на дистанции distance от центра тела */
function ctxAt(distance: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 0.01, 1e12)

  camera.position.set(0, 0, distance)

  return { camera, delta: 0, epoch: 0, elapsed: 0 }
}

function vertexCount(mesh: Mesh): number {
  return mesh.geometry.getAttribute('position').count
}

/** Радиус грубой сферы — истинный радиус меша (у этих пяти без описанного множителя) */
function radiusOf(mesh: Mesh): number {
  return mesh.geometry.boundingSphere!.radius
}

describe.each(CASES)('$name: детализация сферы', ({ make, dense }) => {
  it('строится грубой 64×64', () => {
    expect(vertexCount(make())).toBe(65 * 65)
  })

  it('updateObject с камерой вблизи — своя плотная сегментация', () => {
    const body = make()

    // 3 радиуса при fov 50 — доля кадра ≈ 0.71, выше порога 0.25
    body.updateObject(ctxAt(radiusOf(body) * 3))

    expect(vertexCount(body)).toBe((dense + 1) ** 2)
  })

  it('onBeforeRender с камерой вплотную геометрию не трогает — свап только в updateObject', () => {
    const body = make()
    const coarse = body.geometry
    const { camera } = ctxAt(radiusOf(body) * 3)

    camera.updateMatrixWorld()
    body.updateMatrixWorld()
    body.onBeforeRender(
      {} as WebGLRenderer,
      new Scene(),
      camera,
      body.geometry,
      body.material as Material,
      null as unknown as Group
    )

    expect(body.geometry).toBe(coarse)
  })

  it('onBeforeRender вблизи записывает кадр — следующий updateObject по устаревшей камере плотный', () => {
    const body = make()
    const { camera } = ctxAt(radiusOf(body) * 3)

    camera.updateMatrixWorld()
    body.updateMatrixWorld()
    body.onBeforeRender(
      {} as WebGLRenderer,
      new Scene(),
      camera,
      body.geometry,
      body.material as Material,
      null as unknown as Group
    )
    body.updateObject(ctxAt(radiusOf(body) * 1000))

    expect(vertexCount(body)).toBe((dense + 1) ** 2)
  })

  it('разборка в плотном уровне освобождает плотную геометрию', () => {
    const body = make()

    body.updateObject(ctxAt(radiusOf(body) * 3))

    const dispose = vi.spyOn(body.geometry, 'dispose')

    disposeSceneTree(body)

    expect(dispose).toHaveBeenCalled()
  })
})

describe('погашенная оболочка гиганта', () => {
  it('atmosphereDensity 0 — плотная сфера не строится даже вплотную', () => {
    const shell = new GiantStarShell(new GiantStar(stubGiantActor({ atmosphereDensity: 0 })))

    expect(shell.visible).toBe(false)

    shell.updateObject(ctxAt(radiusOf(shell) * 3))

    expect(vertexCount(shell)).toBe(65 * 65)
  })
})
