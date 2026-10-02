import { describe, expect, it } from 'vitest'
import { AdditiveBlending, Color, Object3D, PerspectiveCamera } from 'three'
import { FakePlanet } from '@/core/renderables/utils/FakePlanet'
import { impostorColorFromActor } from '@/core/renderables/utils/planetImpostorMath'
import { config } from '@/core/framework/config'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'

function stubActor(color?: string): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => (key === 'color' && color !== undefined ? color : def)
  } as unknown as Actor
}

function contextAt(x: number, y = 0): UpdateContext {
  const camera = new PerspectiveCamera()
  camera.position.set(x, y, 0)
  camera.updateMatrixWorld(true)
  return { delta: 0, epoch: 0, elapsed: 0, camera }
}

/** Точка в узле тела на (10, 0, 0) — звезда в нуле сцены. */
function planetAt10(color?: string): FakePlanet {
  const node = new Object3D()
  node.position.set(10, 0, 0)
  const sprite = new FakePlanet(stubActor(color))
  node.add(sprite)
  node.updateMatrixWorld(true)
  return sprite
}

describe('FakePlanet: цвет тела и фаза', () => {
  it('материал прежний: аддитив, без масштабирования по дистанции, без записи глубины', () => {
    const sprite = planetAt10('#6495ed')
    expect(sprite.material.blending).toBe(AdditiveBlending)
    expect(sprite.material.sizeAttenuation).toBe(false)
    expect(sprite.material.depthWrite).toBe(false)
  })

  it('базовый цвет — из Actor.color через impostorColorFromActor', () => {
    const sprite = planetAt10('#6495ed')
    expect(sprite.baseColor.equals(impostorColorFromActor('#6495ed', config('planetImpostor.saturation')))).toBe(true)
  })

  it('камера между звездой и телом (α = 0) — полный базовый цвет', () => {
    const sprite = planetAt10('#6495ed')
    sprite.updateObject(contextAt(5))
    const c = sprite.material.color
    expect(c.r).toBeCloseTo(sprite.baseColor.r, 9)
    expect(c.g).toBeCloseTo(sprite.baseColor.g, 9)
    expect(c.b).toBeCloseTo(sprite.baseColor.b, 9)
  })

  it('камера за телом (α = π) — базовый цвет × пол фазы', () => {
    const sprite = planetAt10('#6495ed')
    sprite.updateObject(contextAt(20))
    const expected = sprite.baseColor.clone().multiplyScalar(config('planetImpostor.phaseFloor'))
    expect(sprite.material.color.r).toBeCloseTo(expected.r, 9)
    expect(sprite.material.color.b).toBeCloseTo(expected.b, 9)
  })

  it('квадратура — 1/π базового, повторный вызов не накапливает множитель', () => {
    const sprite = planetAt10('#6495ed')
    sprite.updateObject(contextAt(10, 7))
    sprite.updateObject(contextAt(10, 7))
    expect(sprite.material.color.g).toBeCloseTo(sprite.baseColor.g / Math.PI, 9)
  })

  it('актор без цвета — опорный серый #b6b6b6, как до фичи', () => {
    const sprite = planetAt10()
    expect(sprite.baseColor.equals(new Color('#b6b6b6'))).toBe(true)
  })
})
