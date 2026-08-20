import { PerspectiveCamera } from 'three'
import type { WebGLRenderer } from 'three'
import { BlackHoleImpostor } from '@/core/renderables/BlackHole/BlackHoleImpostor'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { BlackHoleLod } from '@/core/renderables/utils/BlackHoleLod'
import { apparentSizeAtDistance } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'

const FOV = 50
const VIEWPORT_HEIGHT = 1080

// BlackHoleParameters читает у актора массу и несколько опциональных
// атрибутов — тот же мышиный actor, что в BlackHoleBackgroundSource.spec.ts
function stubActor(temperature: number): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => {
        if (key === 'mass') return 8.54e36
        if (key === 'temperature') return temperature
        return def
      }
    },
    renderingObject: null,
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'Sagittarius A*' : def)
  } as unknown as Actor
}

// Импостор читает у рендерера только domElement.height
function stubRenderer(height: number): WebGLRenderer {
  return { domElement: { height } } as unknown as WebGLRenderer
}

interface Setup {
  impostor: BlackHoleImpostor
  parameters: BlackHoleParameters
  camera: PerspectiveCamera
  switchDistance: number
}

function setup(temperature: number, height: number = VIEWPORT_HEIGHT): Setup {
  const actor: Actor = stubActor(temperature)
  const renderer: WebGLRenderer = stubRenderer(height)
  const parameters = new BlackHoleParameters(actor)
  const impostor = new BlackHoleImpostor(actor, parameters, renderer)

  return {
    impostor,
    parameters,
    camera: new PerspectiveCamera(FOV),
    switchDistance: new BlackHoleLod(parameters.simulationRadius, renderer).switchDistance(FOV)
  }
}

function updateAt(s: Setup, distance: number): void {
  s.camera.position.set(distance, 0, 0)

  const ctx: UpdateContext = { camera: s.camera, delta: 0, epoch: 0, elapsed: 0 }

  s.impostor.updateObject(ctx)
}

/** Экранный диаметр зоны симуляции с учётом фактического масштаба импостора */
function zonePixels(s: Setup, distance: number, height: number = VIEWPORT_HEIGHT): number {
  const worldSize: number = toThreeJSUnits(2 * s.parameters.simulationRadius) * s.impostor.scale.x

  return apparentSizeAtDistance(worldSize, distance, FOV, height)
}

describe('BlackHoleImpostor: пол видимого размера', () => {
  it('на дистанции переключения LOD импостор рисуется своим размером', () => {
    // Порог переключения (45 px) выше пола, поэтому ровно на стыке масштаб
    // обязан быть единичным: иначе размер дыры скакнёт в момент переключения
    const s: Setup = setup(9000)

    updateAt(s, s.switchDistance)

    expect(s.impostor.scale.x).toBeCloseTo(1, 6)
    expect(zonePixels(s, s.switchDistance)).toBeCloseTo(config('blackHole.lodPixels'), 6)
  })

  it('за полом дыра не тает: экранный размер держится на impostorPixels', () => {
    // Двадцать дистанций переключения — тонкое кольцо давно ушло бы в
    // субпиксель и исчезло вместе с блумом
    const s: Setup = setup(9000)
    const distance: number = s.switchDistance * 20

    updateAt(s, distance)

    expect(s.impostor.scale.x).toBeGreaterThan(1)
    expect(zonePixels(s, distance)).toBeCloseTo(config('blackHole.impostorPixels'), 6)
  })

  it('пол переживает ресайз вьюпорта: высота читается живьём', () => {
    const s: Setup = setup(9000, 540)
    const distance: number = s.switchDistance * 20

    updateAt(s, distance)

    expect(zonePixels(s, distance, 540)).toBeCloseTo(config('blackHole.impostorPixels'), 6)
  })

  it('голая дыра без диска не раздувается', () => {
    // Блумить нечему, а раздутая тень — это дыра в звёздном фоне крупнее
    // физической: пол работает только там, где есть что светить
    const s: Setup = setup(0)

    updateAt(s, s.switchDistance * 20)

    expect(s.impostor.scale.x).toBe(1)
  })
})

describe('BlackHole: калибровка под порог блума', () => {
  it('пол включается ПОСЛЕ переключения на импостор, а не до', () => {
    // impostorPixels выше lodPixels означало бы, что пол сработал на живом
    // L0-реймарчере: размер прыгнул бы ровно на стыке
    expect(config('blackHole.impostorPixels')).toBeLessThanOrEqual(config('blackHole.lodPixels'))
  })

  it('дефолтная эмиссия диска перешагивает порог блума с запасом', () => {
    // blackbody нормирован по максимальному каналу, дальше профиль съедает
    // примерно 0.35 — при 6 пик выходил ~2.1 на пороге 1.0, и диск еле блумил
    const parameters = new BlackHoleParameters(stubActor(9000))

    expect(parameters.diskIntensity).toBe(12)
  })
})
