import { describe, it, expect, vi } from 'vitest'
import { PerspectiveCamera, Vector2, WebGLRenderer } from 'three'
import { rockSpin, rodrigues, spinAxis, spinPeriodHash } from './rockSpinMirror'

const fakeTexture = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { InstancedAsteroidShader } from '@/core/materials/shaders/InstancedAsteroidShader'
import { AsteroidRingSystem, type AsteroidRingConfig } from '@/core/renderables/DetailedRingStreamingSystem'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { PlacedNode } from '@/core/renderables/utils/PlacedNode'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { billboardVertexSource } from '../helpers/billboardSource'
import { withoutComments } from '../helpers/glsl'
import { poolOf } from '../helpers/ringSystemInternals'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject, IAsteroidBeltRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'

describe('GLSL: вращение камня (InstancedAsteroidShaderTemplate, L0/Near)', () => {
  it('объявляет uSpinPeriod и uSpinTime — дефолт 0 (выкл)', () => {
    const shader = new InstancedAsteroidShader()
    expect(shader.vertexShader).toContain('uniform float uSpinPeriod;')
    expect(shader.vertexShader).toContain('uniform float uSpinTime;')
    expect(shader.uniforms.uSpinPeriod.value).toBe(0)
    expect(shader.uniforms.uSpinTime.value).toBe(0)
  })

  it('вся ветка вращения — под гейтом if (uSpinPeriod > 0.0), ДО instanceMatrix', () => {
    const v = withoutComments(InstancedAsteroidShaderTemplate.vertexShader)

    expect(v).toContain('if (uSpinPeriod > 0.0) {')
    // Ось/период — из shapeSeed (тот же хеш, что форма), НЕ варьинг
    expect(v).toContain('hashSurface11(shapeSeed + 13.13)')
    expect(v).toContain('hashSurface11(shapeSeed + 17.17)')
    expect(v).toContain('hashSurface11(shapeSeed + 19.19)')
    expect(v).toContain('float spinPeriod = uSpinPeriod * (0.5 + hashSurface11(shapeSeed + 23.23));')
    expect(v).toContain('float spinAngle = 2.0 * PI * uSpinTime / spinPeriod;')
    // Родригес: v' = v·cosA + (axis × v)·sinA + axis·(axis·v)·(1 − cosA) — позиция и нормаль
    expect(v).toContain(
      'shapedPos = shapedPos * cosA + cross(spinAxis, shapedPos) * sinA + spinAxis * dot(spinAxis, shapedPos) * (1.0 - cosA);'
    )
    expect(v).toContain(
      'shapedNormal = shapedNormal * cosA + cross(spinAxis, shapedNormal) * sinA + spinAxis * dot(spinAxis, shapedNormal) * (1.0 - cosA);'
    )

    // Гейт целиком раньше пересборки world-позиции из instanceMatrix
    expect(v.indexOf('if (uSpinPeriod > 0.0)')).toBeLessThan(
      v.indexOf('vec4 worldPosition = instanceMatrix * vec4(shapedPos, 1.0);')
    )
  })

  it('L1 (билборд) не вращается — юниформов вращения нет', () => {
    const l1 = withoutComments(billboardVertexSource())
    expect(l1).not.toContain('uSpinPeriod')
    expect(l1).not.toContain('uSpinTime')
  })
})

describe('CPU-зеркало rockSpin (см. rockSpinMirror.ts)', () => {
  const seeds = [0.02, 0.13, 0.47, 0.81, 0.999]
  const v0: [number, number, number] = [3, -1, 2]

  it('ось вращения — единичный вектор при любом сиде', () => {
    for (const seed of seeds) {
      const axis = spinAxis(seed)
      expect(Math.hypot(...axis)).toBeCloseTo(1, 10)
    }
  })

  it('поворот Родригеса сохраняет длину вектора', () => {
    for (const seed of seeds) {
      const axis = spinAxis(seed)
      for (const angle of [0.3, 1.7, -2.4, Math.PI, 5.1]) {
        const rotated = rodrigues(v0, axis, angle)
        expect(Math.hypot(...rotated)).toBeCloseTo(Math.hypot(...v0), 9)
      }
    }
  })

  it('t = 0 — тождественное преобразование', () => {
    for (const seed of seeds) {
      const rotated = rockSpin(v0, seed, 8 * 3600, 0)
      expect(rotated[0]).toBeCloseTo(v0[0], 9)
      expect(rotated[1]).toBeCloseTo(v0[1], 9)
      expect(rotated[2]).toBeCloseTo(v0[2], 9)
    }
  })

  it('t = один период инстанса — полный оборот, тождественное преобразование', () => {
    for (const seed of seeds) {
      const spinPeriodSeconds = 8 * 3600
      const instancePeriod = spinPeriodSeconds * (0.5 + spinPeriodHash(seed))
      const rotated = rockSpin(v0, seed, spinPeriodSeconds, instancePeriod)
      expect(rotated[0]).toBeCloseTo(v0[0], 6)
      expect(rotated[1]).toBeCloseTo(v0[1], 6)
      expect(rotated[2]).toBeCloseTo(v0[2], 6)
    }
  })

  it('разные сиды дают разные оси/периоды — камни не крутятся синхронно', () => {
    const a = rockSpin(v0, 0.1, 8 * 3600, 100)
    const b = rockSpin(v0, 0.9, 8 * 3600, 100)
    expect(a[0]).not.toBeCloseTo(b[0], 3)
  })
})

const makeRingActor = (data: Partial<IRingRenderingObject> = {}): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1, ...data })
    },
    resources: {
      first: () => ({ getAttribute: () => 'ring.png' })
    }
  }) as unknown as Actor

describe('AsteroidRingSystem: uSpinPeriod / uSpinTime', () => {
  it('кольцо без spinPeriodHours в данных — юниформ 0, прежний вид', () => {
    const system = new AsteroidRingSystem(makeRingActor())
    expect(poolOf(system).geometryMaterial.uniforms.uSpinPeriod.value).toBe(0)
  })

  it('данные кольца задают spinPeriodHours — часы переводятся в секунды сцены (×3600)', () => {
    const system = new AsteroidRingSystem(makeRingActor({ spinPeriodHours: 4 }))
    expect(poolOf(system).geometryMaterial.uniforms.uSpinPeriod.value).toBeCloseTo(4 * 3600, 9)
  })

  it('override spinPeriodHours (пояс) — та же конверсия часы→секунды', () => {
    const overrides: Partial<AsteroidRingConfig> = { spinPeriodHours: 8 }
    const system = new AsteroidRingSystem(makeRingActor(), overrides)
    expect(poolOf(system).geometryMaterial.uniforms.uSpinPeriod.value).toBeCloseTo(8 * 3600, 9)
  })

  it('uSpinTime следует ctx.elapsed (секунды сцены, множитель 1 — см. AsteroidRingSystem.updateObject)', () => {
    const system = new AsteroidRingSystem(makeRingActor(), { spinPeriodHours: 8 })
    const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
    camera.position.set(52, 0, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

    system.updateObject({ delta: 0.016, epoch: 0, elapsed: 12.5, camera } as UpdateContext)

    expect(poolOf(system).geometryMaterial.uniforms.uSpinTime.value).toBe(12.5)
  })
})

// --- Пояс: AsteroidBelt.__createStreamer передаёт spinPeriodHours в стример ---

const fakeRenderer = {
  getSize: (v: Vector2) => {
    v.set(1920, 1080)
    return v
  },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function makeFactory(): RenderableFactory {
  return new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new DepthVolumeRegistry())
}

function beltActor(data: IAsteroidBeltRenderingObject): Actor {
  return {
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (key: string, fallback: unknown = ''): unknown => {
      if (key === 'categoryId') return 11
      if (key === 'name') return 'Ashfall Belt'
      return fallback
    }
  } as unknown as Actor
}

type BeltInternals = { streamer: AsteroidRingSystem | null }
const beltInternalsOf = (belt: AsteroidBelt): BeltInternals => belt as unknown as BeltInternals
const configOf = (system: AsteroidRingSystem): AsteroidRingConfig =>
  (system as unknown as { config: AsteroidRingConfig }).config

function frameAt(belt: AsteroidBelt, x: number, y: number = 0): void {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)
  camera.position.set(x, y, 0)
  camera.updateMatrixWorld(true)
  belt.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)
}

const BELT_DATA: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  meanSpacingKm: 60,
  dustEnabled: false,
  spinPeriodHours: 8
}

describe('AsteroidBelt: __createStreamer передаёт spinPeriodHours (часы) стримеру', () => {
  it('стример пояса получает spinPeriodHours из данных, юниформ — в секундах сцены', () => {
    const node = makeFactory().make(beltActor(BELT_DATA)) as PlacedNode
    const belt = node.children.find((c) => c instanceof AsteroidBelt) as unknown as AsteroidBelt
    node.updateMatrixWorld(true)

    frameAt(belt, fromAstronomicalUnits(50)) // Near — стример создаётся

    const streamer = beltInternalsOf(belt).streamer!
    expect(streamer).not.toBeNull()
    expect(configOf(streamer).spinPeriodHours).toBe(8)
    expect(poolOf(streamer).geometryMaterial.uniforms.uSpinPeriod.value).toBeCloseTo(8 * 3600, 9)
  })

  it('spinPeriodHours: 0 в данных — вращение выключено (дефолт пояса)', () => {
    const node = makeFactory().make(beltActor({ ...BELT_DATA, spinPeriodHours: 0 })) as PlacedNode
    const belt = node.children.find((c) => c instanceof AsteroidBelt) as unknown as AsteroidBelt
    node.updateMatrixWorld(true)

    frameAt(belt, fromAstronomicalUnits(50))

    const streamer = beltInternalsOf(belt).streamer!
    expect(poolOf(streamer).geometryMaterial.uniforms.uSpinPeriod.value).toBe(0)
  })
})
