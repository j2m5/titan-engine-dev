import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Texture } from 'three'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'

const HEIGHT_PATH = 'stub/slopeRange/height.raw'
const SLOPE_PATH = 'stub/slopeRange/slope.webp'
const DIFFUSE_PATH = 'stub/slopeRange/diffuse.png'

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(DIFFUSE_PATH)
}

function seedHeightField(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

interface StubOptions {
  data: Record<string, unknown>
  slopeResource?: boolean
  slopeRange?: number
}

/** Стаб тела: ресурс slope отдаёт slopeRange атрибутом наравне с path (Memoquent getAttribute). */
function stubActor({ data, slopeResource = true, slopeRange }: StubOptions): Actor {
  return {
    renderingObject: { getAttribute: () => data },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: (_field: string, type: string) => ({
        first: () => {
          if (type === 'diffuse') return { getAttribute: () => DIFFUSE_PATH }
          if (type === 'height') return { getAttribute: () => HEIGHT_PATH }
          if (type === 'slope') {
            if (!slopeResource) return undefined

            return { getAttribute: (key: string) => (key === 'path' ? SLOPE_PATH : key === 'slopeRange' ? slopeRange : undefined) }
          }

          return undefined
        }
      })
    }
  } as unknown as Actor
}

describe('uSlopeRange из slope-ресурса', () => {
  it('шаблон включает slopeNormalUniforms под USE_SLOPE до функций', () => {
    const frag = PlanetShaderTemplate.fragmentShader
    const u = frag.indexOf('#include <slopeNormalUniforms>')
    const f = frag.indexOf('#include <slopeNormalFunctions>')
    expect(u).toBeGreaterThan(-1)
    expect(u).toBeLessThan(f)
  })

  describe('конструктор', () => {
    beforeEach(() => seedPlaceholderKeys())
    afterEach(() => resourceStorage.deleteAllTextures())

    it('дефолт SLOPE_RANGE', () => {
      expect(new PlanetShader(stubActor({ data: {} })).uniforms.uSlopeRange.value).toBe(SLOPE_RANGE)
    })
  })

  describe('updateMaterial', () => {
    beforeEach(() => {
      seedPlaceholderKeys()
      seedHeightField()
      seedTexture(SLOPE_PATH, 8, 4)
    })
    afterEach(() => {
      resourceStorage.deleteAllTextures()
      heightFieldStorage.clear()
    })

    it('значение из ресурса (0.5)', () => {
      const material = new PlanetMaterial(stubActor({ data: {}, slopeRange: 0.5 }))
      material.updateMaterial()
      expect(material.uniforms.uSlopeRange.value).toBe(0.5)
    })

    it('без поля slopeRange — SLOPE_RANGE', () => {
      const material = new PlanetMaterial(stubActor({ data: {} }))
      material.updateMaterial()
      expect(material.uniforms.uSlopeRange.value).toBe(SLOPE_RANGE)
    })

    it('resetMaterial возвращает SLOPE_RANGE', () => {
      const material = new PlanetMaterial(stubActor({ data: {}, slopeRange: 0.5 }))
      material.updateMaterial()
      expect(material.uniforms.uSlopeRange.value).toBe(0.5)

      material.resetMaterial()
      expect(material.uniforms.uSlopeRange.value).toBe(SLOPE_RANGE)
    })
  })
})
