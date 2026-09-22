import { describe, it, expect, vi } from 'vitest'
import { PerspectiveCamera, Vector2, WebGLRenderer } from 'three'
import { rockSpin, rodrigues, spinAxis, spinAngleForRate, spinRateSteps, wrapSpinTime } from './rockSpinMirror'
import { J2000 } from '@/core/constants'

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
    // Ставка вращения — m/12, m ∈ [6,18]: непрерывна через свёртку uSpinTime (12·P)
    expect(v).toContain('float m = min(6.0 + floor(hashSurface11(shapeSeed + 23.23) * 13.0), 18.0);')
    expect(v).toContain('float spinAngle = 2.0 * PI * uSpinTime * (m / 12.0) / uSpinPeriod;')
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

  it('ставка вращения m ∈ [6, 18] целыми шагами при любом сиде', () => {
    for (const seed of seeds) {
      const m = spinRateSteps(seed)
      expect(m).toBeGreaterThanOrEqual(6)
      expect(m).toBeLessThanOrEqual(18)
      expect(Number.isInteger(m)).toBe(true)
    }
  })

  it('разные сиды дают разные оси/ставки — камни не крутятся синхронно', () => {
    const a = rockSpin(v0, 0.1, 8 * 3600, 100)
    const b = rockSpin(v0, 0.9, 8 * 3600, 100)
    expect(a[0]).not.toBeCloseTo(b[0], 3)
  })

  it('непрерывность свёртки: для любого m ∈ [6, 18] угол при t = 12·P совпадает с углом при t = 0 (mod 2π)', () => {
    const spinPeriodSeconds = 8 * 3600
    const wrap = 12 * spinPeriodSeconds
    for (let m = 6; m <= 18; m++) {
      const angleAtZero = spinAngleForRate(m, spinPeriodSeconds, 0)
      const angleAtWrap = spinAngleForRate(m, spinPeriodSeconds, wrap)
      const twoPi = 2 * Math.PI
      const modAtZero = ((angleAtZero % twoPi) + twoPi) % twoPi
      const modAtWrap = ((angleAtWrap % twoPi) + twoPi) % twoPi
      expect(modAtWrap).toBeCloseTo(modAtZero, 9)
    }
  })

  it('свёртка времени симуляции: t = s − floor(s/12P)·12P, t=0 и t=12P дают одинаковое вращение камня', () => {
    const seed = 0.37
    const spinPeriodSeconds = 8 * 3600
    const wrap = 12 * spinPeriodSeconds

    const atZero = rockSpin(v0, seed, spinPeriodSeconds, wrapSpinTime(0, spinPeriodSeconds))
    const atOneWrap = rockSpin(v0, seed, spinPeriodSeconds, wrapSpinTime(wrap, spinPeriodSeconds))
    const atOneWrapPlusBit = rockSpin(v0, seed, spinPeriodSeconds, wrapSpinTime(wrap + 100, spinPeriodSeconds))
    const atJustBit = rockSpin(v0, seed, spinPeriodSeconds, wrapSpinTime(100, spinPeriodSeconds))

    expect(wrapSpinTime(wrap, spinPeriodSeconds)).toBeCloseTo(0, 9)
    for (let i = 0; i < 3; i++) {
      expect(atOneWrap[i]).toBeCloseTo(atZero[i], 9)
      expect(atOneWrapPlusBit[i]).toBeCloseTo(atJustBit[i], 9)
    }
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

  it('данные кольца задают spinPeriodHours — часы переводятся в секунды симуляции (×3600)', () => {
    const system = new AsteroidRingSystem(makeRingActor({ spinPeriodHours: 4 }))
    expect(poolOf(system).geometryMaterial.uniforms.uSpinPeriod.value).toBeCloseTo(4 * 3600, 9)
  })

  it('override spinPeriodHours (пояс) — та же конверсия часы→секунды', () => {
    const overrides: Partial<AsteroidRingConfig> = { spinPeriodHours: 8 }
    const system = new AsteroidRingSystem(makeRingActor(), overrides)
    expect(poolOf(system).geometryMaterial.uniforms.uSpinPeriod.value).toBeCloseTo(8 * 3600, 9)
  })

  /** Камера в теле кольца, смотрит на центр — для updateObject достаточно валидного кадра */
  const frameCamera = (system: AsteroidRingSystem, epoch: number): void => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
    camera.position.set(52, 0, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

    system.updateObject({ delta: 0.016, epoch, elapsed: 0, camera } as UpdateContext)
  }

  it('uSpinTime — время СИМУЛЯЦИИ от ctx.epoch (юлианские дни), не рендер-часы: +1 сутки при P=8ч даёт 86400 с', () => {
    const system = new AsteroidRingSystem(makeRingActor(), { spinPeriodHours: 8 })
    frameCamera(system, J2000 + 1)
    expect(poolOf(system).geometryMaterial.uniforms.uSpinTime.value).toBeCloseTo(86400, 6)
  })

  it('uSpinTime сворачивается по 12·P: +5 суток при P=8ч (12P=345600с) даёт 432000 mod 345600 = 86400', () => {
    const system = new AsteroidRingSystem(makeRingActor(), { spinPeriodHours: 8 })
    frameCamera(system, J2000 + 5)
    expect(poolOf(system).geometryMaterial.uniforms.uSpinTime.value).toBeCloseTo(86400, 6)
  })

  it('spinPeriodHours = 0 — uSpinTime не считается (гейт в шейдере и так закрыт)', () => {
    const system = new AsteroidRingSystem(makeRingActor())
    frameCamera(system, J2000 + 5)
    expect(poolOf(system).geometryMaterial.uniforms.uSpinTime.value).toBe(0)
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
  it('стример пояса получает spinPeriodHours из данных, юниформ — в секундах симуляции', () => {
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
