import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOD } from 'three'
import { Actor } from '@/core/models/Actor'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { config } from '@/core/framework/config'
import { distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/**
 * LOD тел с порогом в экранных пикселях — общий ApparentSizeLod: дистанция
 * переключения пересчитывается каждый кадр по живым fov и высоте вьюпорта.
 * Здесь заперта проводка фабрики: какой класс LOD стоит в узле и с какой
 * стартовой дистанцией.
 */

/** Sgr A* — дыра с диском */
const SGR_A_ID: number = 43
const VIEWPORT_HEIGHT: number = 1080

function makeFactory(): RenderableFactory {
  const renderer = { domElement: { width: 1920, height: VIEWPORT_HEIGHT } }
  const resourceObserver = { textureOf: vi.fn(() => null), sceneBackground: null }

  return new RenderableFactory(renderer as never, resourceObserver as never, new AtmosphereRegistry(), new DepthVolumeRegistry())
}

function lodOf(node: DynamicNode): LOD {
  const lod = node.children.find((child): child is LOD => child instanceof LOD)

  if (!lod) throw new Error('LOD не найден в узле')

  return lod
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RenderableFactory: LOD чёрной дыры', () => {
  it('общий ApparentSizeLod по диаметру зоны симуляции с порогом blackHole.lodPixels', () => {
    const node = makeFactory().make(Actor.find(SGR_A_ID)!) as DynamicNode
    const lod = lodOf(node)
    const strong = lod.levels[0].object as BlackHole

    expect(lod).toBeInstanceOf(ApparentSizeLod)
    expect(lod.levels[1].distance).toBeCloseTo(
      distanceForApparentSize(
        toThreeJSUnits(2 * strong.parameters.simulationRadius),
        config('blackHole.lodPixels'),
        config('camera.fov'),
        VIEWPORT_HEIGHT
      ),
      6
    )
    expect(lod.levels[1].hysteresis).toBe(config('blackHole.lodHysteresis'))
  })
})
