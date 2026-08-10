import { Object3D, PerspectiveCamera } from 'three'
import type { WebGLRenderer } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { BlackHoleLod } from '@/core/renderables/utils/BlackHoleLod'
import { blackHole } from '@/config/blackHole'
import { config } from '@/core/framework/config'
import { apparentSizeAtDistance, distanceForApparentSize } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'

const SIMULATION_RADIUS_KM = 319000000
const FOV = 50

// BlackHoleLod читает у рендерера только domElement.height — тот же приём,
// что в tests/renderables/ApparentSize.spec.ts
function stubRenderer(height: number): WebGLRenderer {
  return { domElement: { height } } as unknown as WebGLRenderer
}

function makeLod(renderer: WebGLRenderer): BlackHoleLod {
  const lod = new BlackHoleLod(SIMULATION_RADIUS_KM, renderer)

  lod.addLevel(new Object3D())
  lod.addLevel(new Object3D(), lod.switchDistance(FOV), config('blackHole.lodHysteresis'))

  return lod
}

describe('BlackHoleLod: живой порог переключения', () => {
  it('дистанция считается честной формулой по живой высоте вьюпорта', () => {
    const lod = new BlackHoleLod(SIMULATION_RADIUS_KM, stubRenderer(1080))

    expect(lod.switchDistance(FOV)).toBe(
      distanceForApparentSize(
        toThreeJSUnits(2 * SIMULATION_RADIUS_KM),
        config('blackHole.lodPixels'),
        FOV,
        1080
      )
    )
  })

  it('на дистанции переключения диаметр зоны занимает ровно lodPixels', () => {
    const lod = new BlackHoleLod(SIMULATION_RADIUS_KM, stubRenderer(1080))

    expect(
      apparentSizeAtDistance(toThreeJSUnits(2 * SIMULATION_RADIUS_KM), lod.switchDistance(FOV), FOV, 1080)
    ).toBeCloseTo(config('blackHole.lodPixels'), 6)
  })

  it('после ресайза вьюпорта updateObject пересчитывает дистанцию', () => {
    const renderer = stubRenderer(1080)
    const lod = makeLod(renderer)
    const before: number = lod.levels[1].distance
    const ctx: UpdateContext = { camera: new PerspectiveCamera(FOV), delta: 0, epoch: 0, elapsed: 0 }

    renderer.domElement.height = 540
    lod.updateObject(ctx)

    expect(lod.levels[1].distance).toBeCloseTo(before / 2, 6)
  })

  it('гистерезис переживает пересчёт дистанции', () => {
    const lod = makeLod(stubRenderer(1080))
    const ctx: UpdateContext = { camera: new PerspectiveCamera(FOV), delta: 0, epoch: 0, elapsed: 0 }

    lod.updateObject(ctx)

    expect(lod.levels[1].hysteresis).toBe(config('blackHole.lodHysteresis'))
    expect(config('blackHole.lodHysteresis')).toBeGreaterThan(0)
  })

  it('фактический порог не сместился: 45 честных ≈ 35 по прежней формуле', () => {
    // Прежняя формула — исторический эталон порога, а не образец для
    // подражания: tan(fov) вместо 2·tan(fov/2), из-за чего номинальные 35
    // означали фактические 44.7. Пин держит точку переключения на месте
    const legacy: number = toThreeJSUnits(
      (2 * SIMULATION_RADIUS_KM * 1080) / (Math.tan(degToRad(FOV)) * 35)
    )
    const lod = new BlackHoleLod(SIMULATION_RADIUS_KM, stubRenderer(1080))

    expect(Math.abs(lod.switchDistance(FOV) / legacy - 1)).toBeLessThan(0.01)
  })

  it('пин конфига: lodPixels закреплён на пересчитанном фактическом пороге', () => {
    expect(blackHole.blackHole.lodPixels).toBe(45)
  })

  it('смена fov камеры пересчитывает дистанцию через updateObject', () => {
    // Порог задан в пикселях: узкий fov растягивает пиксели по углу, дистанция
    // растёт. updateObject читает живой ctx.camera.fov — не замороженный
    const renderer = stubRenderer(1080)
    const lod = makeLod(renderer)
    const ctx: UpdateContext = { camera: new PerspectiveCamera(25), delta: 0, epoch: 0, elapsed: 0 }

    lod.updateObject(ctx)

    expect(lod.levels[1].distance).toBe(lod.switchDistance(25))
    expect(lod.switchDistance(25)).toBeGreaterThan(lod.switchDistance(FOV))
  })
})
