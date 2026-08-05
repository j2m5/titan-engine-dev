import { PerspectiveCamera, Texture } from 'three'
import type { WebGLRenderer } from 'three'
import {
  STAR_IMPOSTOR_PIXELS,
  apparentSizeAtDistance,
  distanceForApparentSize,
  starLodSwitchDistance
} from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'

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

// PhysicalObject.getAttribute — единственное, что FakeStar и switchDistance
// читают у Actor; тот же приём, что в tests/star/StarOuterLayerWiring.spec.ts
function stubStarActor(radiusKm: number): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'radius' ? radiusKm : def)
    }
  } as unknown as Actor
}

// FakeStar.updateObject читает только domElement.height — реальный
// WebGLRenderer в jsdom не поднять (нет WebGL), да и не нужен
function stubRenderer(height: number): WebGLRenderer {
  return { domElement: { height } } as unknown as WebGLRenderer
}

describe('стык LOD звезды', () => {
  it('на расстоянии переключения диск звезды и билборд одного размера', () => {
    // Именно это расхождение давало скачок: свитч стоял на 3 пикселях, а
    // билборд рисовал себя в 12. Прогоняются ОБЕ production-стороны —
    // starLodSwitchDistance (её же зовёт RenderableFactory.createStar) и
    // настоящий FakeStar.updateObject — а не формулы, пересчитанные заново
    const radiusKm = 695700
    const fov = 50
    const viewportHeight = 1080

    const switchDistance = starLodSwitchDistance(radiusKm, fov, viewportHeight)

    const diskPixels = apparentSizeAtDistance(toThreeJSUnits(2 * radiusKm), switchDistance, fov, viewportHeight)
    expect(diskPixels).toBeCloseTo(STAR_IMPOSTOR_PIXELS, 6)

    // FakeStar.__setup() достаёт map по имени напрямую (getTexture, не
    // getTextureOrMake) — без регистрации словит console.warn на undefined
    const map = new Texture()
    map.name = 'round.png'
    resourceStorage.addTexture(map)

    try {
      const star = new FakeStar(stubStarActor(radiusKm), stubRenderer(viewportHeight))
      const camera = new PerspectiveCamera(fov)
      camera.position.set(0, 0, 0)
      star.position.set(switchDistance, 0, 0)

      const ctx: UpdateContext = { camera, delta: 0, epoch: 0, elapsed: 0 }
      star.updateObject(ctx)

      const billboardPixels = apparentSizeAtDistance(star.scale.x, switchDistance, fov, viewportHeight)
      expect(billboardPixels).toBeCloseTo(STAR_IMPOSTOR_PIXELS, 6)
    } finally {
      resourceStorage.deleteTexture('round.png')
    }
  })
})
