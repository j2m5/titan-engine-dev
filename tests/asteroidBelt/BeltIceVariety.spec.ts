import { describe, it, expect, vi } from 'vitest'

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

import '@/core/framework/TitanThree'
import { AsteroidRingSystem, type AsteroidRingConfig } from '@/core/renderables/DetailedRingStreamingSystem'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'
import { PerspectiveCamera } from 'three'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { ASTEROID_ICE_SELECT } from '@/core/materials/shaders/lib/chunks/AsteroidIce'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { poolOf } from '../helpers/ringSystemInternals'
import { withoutComments } from '../helpers/glsl'
import { Actor } from '@/core/models/Actor'
import type { IRingRenderingObject } from '@/core/models/types'
import { Color } from 'three'

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

describe('Кольцо: программы камней без ледяной примеси — побайтно прежние', () => {
  it('L0/Near и билборд кольца: тексты вершинника и фрагментника совпадают со снимком, дефайна нет', () => {
    const pool = poolOf(new AsteroidRingSystem(makeRingActor()))

    expect(pool.geometryMaterial.defines).not.toHaveProperty('USE_ICE_VARIETY')
    expect(pool.billboardMaterial.defines).not.toHaveProperty('USE_ICE_VARIETY')

    expect(pool.geometryMaterial.vertexShader).toMatchSnapshot('l0-vertex')
    expect(pool.geometryMaterial.fragmentShader).toMatchSnapshot('l0-fragment')
    expect(pool.billboardMaterial.vertexShader).toMatchSnapshot('billboard-vertex')
    expect(pool.billboardMaterial.fragmentShader).toMatchSnapshot('billboard-fragment')
  })

  it('юниформы льда есть всегда и нейтральны: доля 0', () => {
    const pool = poolOf(new AsteroidRingSystem(makeRingActor()))
    expect(pool.geometryMaterial.uniforms.uIceFraction.value).toBe(0)
    expect(pool.billboardMaterial.uniforms.uIceFraction.value).toBe(0)
    expect(pool.geometryMaterial.uniforms.uIceRockColor).toBeDefined()
    expect(pool.billboardMaterial.uniforms.uIceRockColor).toBeDefined()
  })
})

/** Текст определения функции GLSL по имени, пробелы схлопнуты — сравнение между шейдерами */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n  }', start)
  return source.slice(start, end).replace(/\s+/g, ' ')
}

describe('Материалы с ледяной примесью: дефайн, выбор един для тиров', () => {
  const l0 = new InstancedAsteroidMaterial(undefined, undefined, true)
  const billboard = new BillboardAsteroidMaterial(undefined, false, true)

  it('дефайн USE_ICE_VARIETY стоит в обоих материалах', () => {
    expect(l0.defines.USE_ICE_VARIETY).toBe('1')
    expect(billboard.defines.USE_ICE_VARIETY).toBe('1')
  })

  it('выражение выбора — хеш МЕСТНОЙ позиции инстанса, буквально одно в L0 и билборде', () => {
    expect(ASTEROID_ICE_SELECT).toBe('step(1.0 - uIceFraction, hashSurface11(hash13(instanceMatrix[3].xyz) + 53.53))')
    const line = `vIce = ${ASTEROID_ICE_SELECT};`
    expect(withoutComments(l0.vertexShader)).toContain(line)
    expect(withoutComments(billboard.vertexShader)).toContain(line)
  })

  it('хеши билборда — те же определения, что у L0 (без чанков формы/шумов текст не расходится)', () => {
    for (const signature of ['float hash13(vec3 p3) {', 'float hashSurface11(float x) {']) {
      expect(functionBody(billboard.vertexShader, signature)).toBe(functionBody(l0.vertexShader, signature))
    }
  })

  it('L0: ручки профиля читаются через смеси по vIce, хеша во фрагменте по-прежнему нет', () => {
    const fs = withoutComments(l0.fragmentShader)
    expect(fs).toContain('vec3 rockColor = mix(uRockColor, uIceRockColor, vIce);')
    expect(fs).toContain('float specularStrength = mix(uSpecularStrength, uIceSpecularStrength, vIce);')
    expect(fs).toContain('float specularPower = mix(uSpecularPower, uIceSpecularPower, vIce);')
    expect(fs).toContain('float specularTint = mix(uSpecularTint, uIceSpecularTint, vIce);')
    expect(fs).toContain('float lunarMix = mix(uLunarMix, uIceLunarMix, vIce);')
    expect(fs).toContain('float surfaceAmbient = mix(uSurfaceAmbient, uIceSurfaceAmbient, vIce);')

    expect(fs).toContain('applyAsteroidSurface(surfDir, vTintSeed, vDomainOffset, rockColor, uColorJitter')
    expect(fs).toContain('float specStrength = specularStrength;')
    expect(fs).toContain('float specPower = specularPower;')
    expect(fs).toContain('asteroidRegolithDiffuse(NdotL, NdotV, cosPhase, lunarMix, uOppositionSurge)')
    expect(fs).toContain('mix(vec3(1.0), albedo, specularTint)')
    expect(fs).toContain('* direct + surfaceAmbient)')
    expect(fs).toContain('* direct * uLightColor + surfaceAmbient)')
    // Единственное вхождение — определение в чанке шумов (анти-ULP-джиттер)
    expect((l0.fragmentShader.match(/hashSurface11\(/g) ?? []).length).toBe(1)
  })

  it('билборд: цвет породы смешан к ледяному по vIce', () => {
    expect(withoutComments(billboard.fragmentShader)).toContain(
      'vec3 base = mix(uColor, uIceRockColor, vIce) * (1.0 + uColorJitter * (vInstanceSeed - 0.5) * 2.0);'
    )
  })

  it('билборд: реголитная модель по той же смеси, что у L0 — тир не меняет освещение льда', () => {
    expect(withoutComments(billboard.fragmentShader)).toContain(
      'asteroidRegolithDiffuse(NdotL, normal.z, vLightDirView.z, mix(uLunarMix, uIceLunarMix, vIce), uOppositionSurge)'
    )
    expect(billboard.uniforms.uIceLunarMix).toBeDefined()
  })
})

describe('AsteroidRingSystem: iceVariety заполняет юниформы из ледяного профиля', () => {
  const overrides: Partial<AsteroidRingConfig> = { iceVariety: { fraction: 0.15, profile: 'icy' } }

  it('оба материала с дефайном, доля в обоих, цвет и ручки блика/освещения из профиля icy', () => {
    const pool = poolOf(new AsteroidRingSystem(makeRingActor(), overrides))
    const icy = ASTEROID_PROFILES.icy
    const rocks = pool.geometryMaterial.uniforms
    const sprites = pool.billboardMaterial.uniforms

    expect(pool.geometryMaterial.defines.USE_ICE_VARIETY).toBe('1')
    expect(pool.billboardMaterial.defines.USE_ICE_VARIETY).toBe('1')

    expect(rocks.uIceFraction.value).toBe(0.15)
    expect(sprites.uIceFraction.value).toBe(0.15)
    expect((rocks.uIceRockColor.value as Color).getHex()).toBe(0xc4d2dc)
    expect((sprites.uIceRockColor.value as Color).getHex()).toBe(0xc4d2dc)
    expect(sprites.uIceLunarMix.value).toBe(0.5)
    expect(rocks.uIceSpecularStrength.value).toBe(0.5)
    expect(rocks.uIceSpecularPower.value).toBe(12)
    expect(rocks.uIceSpecularTint.value).toBe(icy.specularTint)
    expect(rocks.uIceLunarMix.value).toBe(0.5)
    expect(rocks.uIceSurfaceAmbient.value).toBe(icy.surfaceAmbient)
    // Базовый профиль кольца не тронут
    expect((rocks.uRockColor.value as Color).getHex()).toBe(ASTEROID_PROFILES.stony.baseColor)
  })

  it('другой ледяной профиль — его ручки', () => {
    const pool = poolOf(new AsteroidRingSystem(makeRingActor(), { iceVariety: { fraction: 0.3, profile: 'metallic' } }))
    const rocks = pool.geometryMaterial.uniforms
    expect(rocks.uIceFraction.value).toBe(0.3)
    expect((rocks.uIceRockColor.value as Color).getHex()).toBe(ASTEROID_PROFILES.metallic.baseColor)
    expect(rocks.uIceSpecularPower.value).toBe(ASTEROID_PROFILES.metallic.specularPower)
  })
})

// --- CPU-зеркало выбора: float32 как в GLSL (Math.fround на каждом шаге) ---

const f = Math.fround
const fract = (x: number): number => f(x - Math.floor(x))

/** Зеркало hash13 (Dave Hoskins) из чанка AsteroidShape */
function hash13(x: number, y: number, z: number): number {
  let px = fract(f(x * f(0.1031)))
  let py = fract(f(y * f(0.1031)))
  let pz = fract(f(z * f(0.1031)))
  // dot(p3, p3.zyx + 31.32)
  const d = f(f(f(px * f(pz + f(31.32))) + f(py * f(py + f(31.32)))) + f(pz * f(px + f(31.32))))
  px = f(px + d)
  py = f(py + d)
  pz = f(pz + d)
  return fract(f(f(px + py) * pz))
}

/** Зеркало hashSurface11 из чанка Noise */
const hashSurface11 = (x: number): number => fract(f(Math.sin(f(x * f(91.3458))) * f(47453.5453)))

/** step(1 − fraction, h): 1 — ледяное тело */
const iceSelect = (fraction: number, x: number, y: number, z: number): number =>
  hashSurface11(f(hash13(x, y, z) + f(53.53))) >= f(1 - fraction) ? 1 : 0

/** Детерминированный LCG — воспроизводимая выборка позиций */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('CPU-зеркало выбора льда: хеш распределяет долю ровно', () => {
  it('на 10 000 случайных местных позиций доля ледяных ≈ 0.15 ± 0.02', () => {
    const rand = lcg(20260923)
    const n = 10000
    let icy = 0
    for (let i = 0; i < n; i++) {
      // Местные позиции в секторе: единицы сцены, до сотен в обе стороны
      const x = (rand() - 0.5) * 1000
      const y = (rand() - 0.5) * 40
      const z = (rand() - 0.5) * 1000
      icy += iceSelect(0.15, x, y, z)
    }
    expect(icy / n).toBeGreaterThan(0.13)
    expect(icy / n).toBeLessThan(0.17)
  })

  it('доля 0 — никого, доля 1 — всех', () => {
    const rand = lcg(7)
    for (let i = 0; i < 200; i++) {
      const x = (rand() - 0.5) * 1000
      const z = (rand() - 0.5) * 1000
      expect(iceSelect(0, x, 1, z)).toBe(0)
      expect(iceSelect(1, x, 1, z)).toBe(1)
    }
  })

  it('выбор — функция позиции: соседние камни не коррелируют', () => {
    // Два соседа на расстоянии 1 единицы: хеш различает их
    const a = Array.from({ length: 64 }, (_, i) => iceSelect(0.5, i * 1.0, 0, 0))
    expect(new Set(a).size).toBe(2)
  })
})

// --- Пояс: AsteroidBelt.__createStreamer передаёт примесь стримеру ---

const BELT_DATA: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  sizeRangeKm: [0.5, 60],
  spacingKm: 54,
  dustEnabled: false
}

const beltActorOf = (data: IAsteroidBeltRenderingObject): Actor =>
  ({
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'categoryId' ? 11 : f)
  }) as unknown as Actor

/** Стример рождается при первом кадре внутри тора; обход — как у движка */
const streamerOf = (belt: AsteroidBelt): AsteroidRingSystem => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)
  camera.position.set(fromAstronomicalUnits(50), 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  belt.updateMatrixWorld(true)
  belt.traverse((o) => o.updateObject({ delta: 0.016, epoch: 2451545, elapsed: 0, camera } as UpdateContext))
  return (belt as unknown as { streamer: AsteroidRingSystem }).streamer
}

describe('AsteroidBelt: ледяная примесь доходит до стримера', () => {
  it('доля 0.15 из данных — дефайн в обоих материалах пула, доля и цвет icy в юниформах', () => {
    const pool = poolOf(streamerOf(new AsteroidBelt(beltActorOf({ ...BELT_DATA, iceFraction: 0.15 }))))

    for (const material of [pool.geometryMaterial, pool.billboardMaterial]) {
      expect(material.defines.USE_ICE_VARIETY).toBe('1')
      expect(material.uniforms.uIceFraction.value).toBe(0.15)
      expect((material.uniforms.uIceRockColor.value as Color).getHex()).toBe(ASTEROID_PROFILES.icy.baseColor)
    }
  })

  it('дефолт данных без поля — та же примесь 0.15', () => {
    const pool = poolOf(streamerOf(new AsteroidBelt(beltActorOf(BELT_DATA))))
    expect(pool.geometryMaterial.uniforms.uIceFraction.value).toBe(0.15)
  })

  it('доля 0 — опции нет: дефайн отсутствует, доля в юниформе 0', () => {
    const pool = poolOf(streamerOf(new AsteroidBelt(beltActorOf({ ...BELT_DATA, iceFraction: 0 }))))

    for (const material of [pool.geometryMaterial, pool.billboardMaterial]) {
      expect(material.defines).not.toHaveProperty('USE_ICE_VARIETY')
      expect(material.uniforms.uIceFraction.value).toBe(0)
    }
  })

  it('iceProfile из данных выбирает профиль примеси', () => {
    const pool = poolOf(streamerOf(new AsteroidBelt(beltActorOf({ ...BELT_DATA, iceProfile: 'metallic' }))))
    const rocks = pool.geometryMaterial.uniforms
    expect((rocks.uIceRockColor.value as Color).getHex()).toBe(ASTEROID_PROFILES.metallic.baseColor)
    expect(rocks.uIceSpecularPower.value).toBe(ASTEROID_PROFILES.metallic.specularPower)
  })
})
