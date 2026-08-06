import { Object3D, PerspectiveCamera, SphereGeometry, Texture } from 'three'
import type { WebGLRenderer } from 'three'
import {
  STAR_IMPOSTOR_PIXELS,
  apparentSizeAtDistance,
  distanceForApparentSize
} from '@/core/helpers/apparentSize'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { Star } from '@/core/renderables/Star'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'
import { config } from '@/core/framework/config'

describe('apparentSize: видимый размер и расстояние', () => {
  it('перевод туда и обратно тождественен', () => {
    // Единственный инвариант, который делает стык LOD согласованным: обе
    // стороны обязаны считать одну величину одной функцией
    const distance = distanceForApparentSize(1000, 12, 50, 1080)

    expect(apparentSizeAtDistance(1000, distance, 50, 1080)).toBeCloseTo(12, 6)
  })

  it('высота кадра считается через 2 * tan(fov / 2), а не tan(fov)', () => {
    // Объект размером во всю высоту кадра на расстоянии d занимает ровно
    // viewportHeight пикселей. tan(fov) даёт здесь ошибку около 28%
    const distance = 100
    const frameHeight = 2 * Math.tan((50 * Math.PI) / 180 / 2) * distance

    expect(apparentSizeAtDistance(frameHeight, distance, 50, 1080)).toBeCloseTo(1080, 6)
  })

  it('вдвое дальше — вдвое мельче', () => {
    const near = apparentSizeAtDistance(1000, 500, 50, 1080)
    const far = apparentSizeAtDistance(1000, 1000, 50, 1080)

    expect(near / far).toBeCloseTo(2, 6)
  })

  it('размер импостора звезды — общая константа, а не число в двух местах', () => {
    expect(STAR_IMPOSTOR_PIXELS).toBe(12)
  })
})

const RADIUS_KM: number = 695700
const FOV: number = 50

// getAttribute — единственное, что Star, FakeStar и StarLod читают у Actor;
// тот же приём, что в tests/star/StarOuterLayerWiring.spec.ts
function stubStarActor(radiusKm: number): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'radius' ? radiusKm : def)
    }
  } as unknown as Actor
}

// FakeStar и StarLod читают у рендерера только domElement.height — реальный
// WebGLRenderer в jsdom не поднять (нет WebGL), да и не нужен
function stubRenderer(height: number): WebGLRenderer {
  return { domElement: { height } } as unknown as WebGLRenderer
}

interface Junction {
  lod: StarLod
  disk: Star
  star: FakeStar
  camera: PerspectiveCamera
  ctx: UpdateContext
}

// Стык собирается из production-классов: StarLod с настоящими Star и FakeStar
// уровнями — ту же тройку строит RenderableFactory.createStar
function makeJunction(renderer: WebGLRenderer): Junction {
  const actor: Actor = stubStarActor(RADIUS_KM)
  const lod = new StarLod(RADIUS_KM, renderer)
  const disk = new Star(actor)
  const star = new FakeStar(actor, renderer)
  const camera = new PerspectiveCamera(FOV)

  lod.addLevel(disk)
  lod.addLevel(star, lod.switchDistance(FOV), config('star.lodHysteresis'))

  return { lod, disk, star, camera, ctx: { camera, delta: 0, epoch: 0, elapsed: 0 } }
}

/** Мировой диаметр диска — из геометрии самой звезды, а не из формулы теста */
function diskWorldSize(disk: Star): number {
  return 2 * (disk.geometry as SphereGeometry).parameters.radius * disk.scale.x
}

describe('стык LOD звезды', () => {
  // FakeStar.__setup достаёт map по имени напрямую (getTexture, не
  // getTextureOrMake) — без регистрации словит console.warn на undefined
  beforeEach(() => {
    const map = new Texture()
    map.name = 'round.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('round.png')
  })

  it('на расстоянии переключения диск звезды и билборд одного размера', () => {
    // Тест держит СОГЛАСОВАННОСТЬ двух сторон, а не формулу: обе считают
    // видимый размер одной парой взаимно обратных функций, так что подмена
    // самой формулы оставит его зелёным — её стережёт тест «высота кадра
    // считается через 2 * tan(fov / 2)» выше
    const renderer: WebGLRenderer = stubRenderer(1080)
    const { lod, disk, star, camera, ctx } = makeJunction(renderer)

    lod.updateObject(ctx)

    const switchDistance: number = lod.levels[1].distance

    camera.position.set(switchDistance, 0, 0)
    star.updateObject(ctx)

    expect(apparentSizeAtDistance(diskWorldSize(disk), switchDistance, FOV, 1080)).toBeCloseTo(
      STAR_IMPOSTOR_PIXELS,
      6
    )
    expect(apparentSizeAtDistance(star.scale.x, switchDistance, FOV, 1080)).toBeCloseTo(STAR_IMPOSTOR_PIXELS, 6)
  })

  it('после ресайза вьюпорта стык остаётся сведённым', () => {
    // Дистанция переключения обязана мериться той же высотой вьюпорта, что и
    // билборд, а тот читает её живьём каждый кадр: замороженная при создании
    // дистанция после ресайза вдвое даёт на стыке диск в 6 пикселей против 12
    const renderer: WebGLRenderer = stubRenderer(1080)
    const { lod, disk, star, camera, ctx } = makeJunction(renderer)

    renderer.domElement.height = 540
    lod.updateObject(ctx)

    const switchDistance: number = lod.levels[1].distance

    camera.position.set(switchDistance, 0, 0)
    star.updateObject(ctx)

    expect(apparentSizeAtDistance(diskWorldSize(disk), switchDistance, FOV, 540)).toBeCloseTo(STAR_IMPOSTOR_PIXELS, 6)
    expect(apparentSizeAtDistance(star.scale.x, switchDistance, FOV, 540)).toBeCloseTo(STAR_IMPOSTOR_PIXELS, 6)
  })

  it('билборд меряет расстояние до камеры в мировых координатах', () => {
    // Локальная позиция билборда всегда (0,0,0): тело живёт на родительском
    // DynamicNode. По локальной мерилось бы расстояние до начала сцены, а
    // LOD.update переключает уровень по мировой дистанции камера↔звезда
    const renderer: WebGLRenderer = stubRenderer(1080)
    const { lod, star, camera, ctx } = makeJunction(renderer)
    const node = new Object3D()

    lod.updateObject(ctx)

    const switchDistance: number = lod.levels[1].distance
    // порядок смещения барицентра двойной системы — доли дистанции переключения
    const offset: number = 10272

    node.add(lod)
    node.position.set(offset, 0, 0)
    camera.position.set(offset + switchDistance, 0, 0)

    star.updateObject(ctx)

    expect(apparentSizeAtDistance(star.scale.x, switchDistance, FOV, 1080)).toBeCloseTo(STAR_IMPOSTOR_PIXELS, 6)
  })

  it('гистерезис доезжает до уровня билборда и переживает пересчёт дистанции', () => {
    // Прямое переключение (диск → билборд) происходит на нетронутой дистанции
    // стыка — гистерезис по контракту three ужимает порог только при уже
    // видимом билборде. StarLod.updateObject пишет только levels[1].distance
    // и хранимый addLevel'ом hysteresis затирать не должен
    const renderer: WebGLRenderer = stubRenderer(1080)
    const { lod, ctx } = makeJunction(renderer)

    lod.updateObject(ctx)

    expect(lod.levels[1].hysteresis).toBe(config('star.lodHysteresis'))
    expect(config('star.lodHysteresis')).toBeGreaterThan(0)
  })
})
