import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Texture, Vector3, WebGLRenderer } from 'three'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { PulsarBeams } from '@/core/renderables/Pulsar/PulsarBeams'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { OrientationModel } from '@/core/libs/OrientationModel'
import { Actor } from '@/core/models/Actor'
import type { IPulsarRenderingObject } from '@/core/models/types'

/** WebGL-контекста в jsdom нет; фабрике от рендерера нужны только эти вызовы */
const fakeRenderer = {
  domElement: { height: 1080 },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

const makeFactory = (): RenderableFactory =>
  new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new DepthVolumeRegistry())

function pulsarActor(data: IPulsarRenderingObject, rotation: { ascendingNode: number; inclination: number } | null): Actor {
  const row = (r: Record<string, number> | null) => (r ? { getAttribute: (k: string, f = 0): number => r[k] ?? f } : null)
  return {
    placement: null,
    orbit: null,
    parent: null,
    rotation: row(rotation),
    physicalObject: row({ radius: 10, temperature: 1e6, mass: 2.8e30, rotationPeriod: 0.0000092, axialTilt: 0 }),
    renderingObject: { getAttribute: (): unknown => data },
    resources: { first: () => null },
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'categoryId' ? 12 : k === 'name' ? 'PSR' : f)
  } as unknown as Actor
}

describe('RenderableFactory: пульсар', () => {
  beforeEach(() => {
    const map = new Texture()
    map.name = 'sun.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('sun.png')
  })

  it('узел несёт LOD с телом и импостором, гало и лучи с кватернионом полюса', () => {
    const actor = pulsarActor({ beamIntensity: 6 }, { ascendingNode: 125, inclination: 62 })
    const node = makeFactory().make(actor)

    const lod = node.children.find((c) => c instanceof ApparentSizeLod)
    const halo = lod?.children.find((c) => c instanceof StarInnerLayer)
    const beams = node.children.find((c) => c instanceof PulsarBeams) as PulsarBeams | undefined

    expect(lod).toBeDefined()
    expect(halo).toBeDefined()
    expect(beams).toBeDefined()
    expect(beams!.quaternion.angleTo(new OrientationModel(actor).getPoleQuaternion())).toBeCloseTo(0, 6)
  })

  it('beamIntensity 0 — лучей нет', () => {
    const node = makeFactory().make(pulsarActor({ beamIntensity: 0 }, null))

    expect(node.children.some((c) => c instanceof PulsarBeams)).toBe(false)
  })

  it('без строки вращения лучи стоят вдоль +Y узла (полюс по умолчанию), узел не падает', () => {
    const node = makeFactory().make(pulsarActor({}, null))
    const beams = node.children.find((c) => c instanceof PulsarBeams) as PulsarBeams
    const up = new Vector3(0, 1, 0).applyQuaternion(beams.quaternion)

    expect(up.angleTo(new Vector3(0, 1, 0))).toBeCloseTo(0, 6)
  })

  it('тело и импостор при 1e6 К и 10 км — конечные юниформы (нет NaN в цвете и яркости)', () => {
    const node = makeFactory().make(pulsarActor({}, null))
    const lod = node.children.find((c) => c instanceof ApparentSizeLod)!
    let checked = 0
    for (const level of lod.children) {
      const mat = (level as { material?: { uniforms?: Record<string, { value: unknown }> } }).material
      if (!mat?.uniforms) continue
      for (const [k, u] of Object.entries(mat.uniforms)) {
        const v = u.value
        if (typeof v === 'number') {
          expect(Number.isFinite(v), k).toBe(true)
          checked++
        } else if (v && (v as { isColor?: boolean }).isColor) {
          const c = v as { r: number; g: number; b: number }
          expect([c.r, c.g, c.b].every(Number.isFinite), k).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
