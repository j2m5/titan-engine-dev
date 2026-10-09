import { describe, it, expect, vi, afterEach } from 'vitest'
import { CubeTexture } from 'three'
import { config } from '@/core/framework/config'
import { SCENE_TO_GALACTIC } from '@/core/sky/galacticFrame'
import { GAIA_LEVELS, gaiaTileByteLength, gaiaTiles, type GaiaTile } from '@/core/sky/gaiaTiles'
import { createGaiaSkyUniforms, gaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'
import { GaiaSky, type GaiaSkyRenderer } from '@/core/sky/GaiaSky'

const GL = {
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  RGB9_E5: 0x8c3d,
  RGB: 0x1907,
  UNSIGNED_INT_5_9_9_9_REV: 0x8c3e,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  CLAMP_TO_EDGE: 0x812f,
  LINEAR: 0x2601,
  NEAREST: 0x2600,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  TEXTURE_MAX_LEVEL: 0x813d,
  TEXTURE_MAX_LOD: 0x813b,
  TEXTURE_MIN_LOD: 0x813a,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_ALIGNMENT: 0x0cf5
}
const ANISOTROPY = 0x84fe

interface Call {
  name: string
  args: unknown[]
  bound: unknown
}

function fakeRenderer() {
  const calls: Call[] = []
  let bound: unknown = null
  let nextId = 1
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args, bound })
    }
  const gl = {
    ...GL,
    createTexture: () => ({ id: nextId++ }),
    texStorage2D: record('texStorage2D'),
    texParameteri: record('texParameteri'),
    texParameterf: record('texParameterf'),
    texSubImage2D: record('texSubImage2D'),
    pixelStorei: record('pixelStorei'),
    deleteTexture: record('deleteTexture'),
    bindTexture: (): never => {
      throw new Error('голый gl.bindTexture: кэш привязок three разойдётся с GL')
    }
  }
  const store = new Map<unknown, Record<string, unknown>>()
  const renderer = {
    getContext: () => gl,
    state: {
      bindTexture: (_type: number, texture: unknown) => {
        bound = texture
      }
    },
    properties: {
      get: (object: unknown) => {
        if (!store.has(object)) store.set(object, {})
        return store.get(object)
      },
      remove: (object: unknown) => store.delete(object)
    },
    extensions: {
      get: (name: string) => (name === 'EXT_texture_filter_anisotropic' ? { TEXTURE_MAX_ANISOTROPY_EXT: ANISOTROPY } : null)
    },
    capabilities: { getMaxAnisotropy: () => 16 }
  }
  return { renderer: renderer as unknown as GaiaSkyRenderer, calls, store }
}

const tails: GaiaTile[] = gaiaTiles().filter((tile) => tile.level === 4)
const level3: GaiaTile[] = gaiaTiles().filter((tile) => tile.level === 3)
const ok = (tile: GaiaTile): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(gaiaTileByteLength(tile)))
const of = (calls: Call[], name: string): Call[] => calls.filter((call) => call.name === name)
const idOf = (call: Call): number => (call.bound as { id: number }).id

afterEach(() => vi.restoreAllMocks())

describe('gaiaSkyUniforms', () => {
  it('значения из конфига: экспозиция 2^стопов, потолок, ориентация, уровень «ничего»', () => {
    const uniforms = createGaiaSkyUniforms()
    expect(uniforms.uGaiaExposure.value).toBe(2 ** config('background.gaia.exposureStops'))
    expect(uniforms.uGaiaStarCeiling.value).toBe(config('background.gaia.starCeiling'))
    expect(uniforms.uGaiaOrientation.value.equals(SCENE_TO_GALACTIC)).toBe(true)
    expect(uniforms.uGaiaMinLod.value).toBe(GAIA_LEVELS)
    expect(uniforms.uGaiaGalaxy.value).toBeNull()
  })

  it('общий набор приложения отделён от свежих наборов фабрики', () => {
    expect(createGaiaSkyUniforms().uGaiaMinLod).not.toBe(gaiaSkyUniforms.uGaiaMinLod)
  })
})

describe('GaiaSky', () => {
  it('start: три кубмапы RGB9_E5 — галактика 12 ур. 2048², звёзды 7 ур. 2048², грубые 5 ур. 16²', () => {
    const { renderer, calls } = fakeRenderer()
    void new GaiaSky(renderer, createGaiaSkyUniforms(), ok, []).start()

    expect(of(calls, 'texStorage2D').map((call) => call.args)).toEqual([
      [GL.TEXTURE_CUBE_MAP, 12, GL.RGB9_E5, 2048, 2048],
      [GL.TEXTURE_CUBE_MAP, 7, GL.RGB9_E5, 2048, 2048],
      [GL.TEXTURE_CUBE_MAP, 5, GL.RGB9_E5, 16, 16]
    ])
    const filters = of(calls, 'texParameteri')
      .filter((call) => call.args[1] === GL.TEXTURE_MIN_FILTER)
      .map((call) => call.args[2])
    expect(filters).toEqual([GL.LINEAR_MIPMAP_LINEAR, GL.NEAREST_MIPMAP_NEAREST, GL.LINEAR_MIPMAP_LINEAR])
  })

  it('анизотропия — только у линейных текстур (галактика, грубые звёзды)', () => {
    const { renderer, calls } = fakeRenderer()
    void new GaiaSky(renderer, createGaiaSkyUniforms(), ok, []).start()

    const anisotropic = of(calls, 'texParameterf').filter((call) => call.args[1] === ANISOTROPY)
    expect(anisotropic.map(idOf)).toEqual([1, 3])
    expect(anisotropic.every((call) => call.args[2] === 16)).toBe(true)
  })

  it('обёртки: юниформы получают CubeTexture, чей __webglTexture — созданная GL-текстура', () => {
    const { renderer, store } = fakeRenderer()
    const uniforms = createGaiaSkyUniforms()
    void new GaiaSky(renderer, uniforms, ok, []).start()

    const expected = [
      [uniforms.uGaiaGalaxy, 1],
      [uniforms.uGaiaStars, 2],
      [uniforms.uGaiaStarsCoarse, 3]
    ] as const
    for (const [uniform, id] of expected) {
      expect(uniform.value).toBeInstanceOf(CubeTexture)
      expect(uniform.value!.version).toBe(0)
      expect((store.get(uniform.value)!.__webglTexture as { id: number }).id).toBe(id)
    }
  })

  it('повторный start — без эффекта: небо одно на все сценарии', () => {
    const { renderer, calls } = fakeRenderer()
    const sky = new GaiaSky(renderer, createGaiaSkyUniforms(), ok, [])
    void sky.start()
    expect(sky.start()).toBeNull()
    expect(of(calls, 'texStorage2D')).toHaveLength(3)
  })

  it('хвосты всех граней: уровни 4…11 залиты, uGaiaMinLod = 4, MIN_LOD галактики = 4', async () => {
    const { renderer, calls } = fakeRenderer()
    const uniforms = createGaiaSkyUniforms()
    await new GaiaSky(renderer, uniforms, ok, tails).start()

    const uploads = of(calls, 'texSubImage2D')
    expect(uploads).toHaveLength(6 * 8 * 2)
    const coarseLevels = uploads.filter((call) => idOf(call) === 3).map((call) => call.args[1])
    expect(new Set(coarseLevels)).toEqual(new Set([0, 1, 2, 3, 4]))
    expect(uploads[0].args[0]).toBe(GL.TEXTURE_CUBE_MAP_POSITIVE_X)
    expect(uploads[0].args.slice(6, 8)).toEqual([GL.RGB, GL.UNSIGNED_INT_5_9_9_9_REV])
    expect(uniforms.uGaiaMinLod.value).toBe(4)
    const minLods = of(calls, 'texParameterf').filter((call) => call.args[1] === GL.TEXTURE_MIN_LOD)
    expect(minLods.map((call) => call.args[2])).toEqual([11, 4])
    expect(minLods.every((call) => idOf(call) === 1)).toBe(true)
  })

  it('неполный уровень не засчитывается: тайл уровня 3 одной грани — уровень остаётся 4', async () => {
    const { renderer } = fakeRenderer()
    const uniforms = createGaiaSkyUniforms()
    await new GaiaSky(renderer, uniforms, ok, [...tails, level3[0]]).start()
    expect(uniforms.uGaiaMinLod.value).toBe(4)
  })

  it('флаги распаковки сброшены до первой заливки (flipY three не переворачивает тайлы)', async () => {
    const { renderer, calls } = fakeRenderer()
    await new GaiaSky(renderer, createGaiaSkyUniforms(), ok, tails.slice(0, 1)).start()

    const firstUpload = calls.findIndex((call) => call.name === 'texSubImage2D')
    const flip = calls.findIndex(
      (call) => call.name === 'pixelStorei' && call.args[0] === GL.UNPACK_FLIP_Y_WEBGL && call.args[1] === false
    )
    expect(flip).toBeGreaterThanOrEqual(0)
    expect(flip).toBeLessThan(firstUpload)
  })

  it('тайлов нет — одно предупреждение с командой скачивания', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { renderer } = fakeRenderer()
    await new GaiaSky(renderer, createGaiaSkyUniforms(), () => Promise.reject(new Error('404')), tails).start()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('npm run fetch:gaia-sky')
  })

  it('dispose: текстуры удалены, юниформы пусты, уровень — «ничего»; start создаёт заново', async () => {
    const { renderer, calls, store } = fakeRenderer()
    const uniforms = createGaiaSkyUniforms()
    const sky = new GaiaSky(renderer, uniforms, ok, tails)
    await sky.start()
    const wrapper = uniforms.uGaiaGalaxy.value

    sky.dispose()
    expect(of(calls, 'deleteTexture')).toHaveLength(3)
    expect(uniforms.uGaiaGalaxy.value).toBeNull()
    expect(uniforms.uGaiaMinLod.value).toBe(GAIA_LEVELS)
    expect(store.has(wrapper)).toBe(false)

    expect(sky.start()).not.toBeNull()
    expect(of(calls, 'texStorage2D')).toHaveLength(6)
  })

  it('тайл, пришедший после dispose, не пишется', async () => {
    const { renderer, calls } = fakeRenderer()
    let release: () => void = () => {}
    const late = (tile: GaiaTile): Promise<ArrayBuffer> =>
      new Promise((resolve) => {
        release = () => resolve(new ArrayBuffer(gaiaTileByteLength(tile)))
      })
    const sky = new GaiaSky(renderer, createGaiaSkyUniforms(), late, tails.slice(0, 1))
    const loading = sky.start()!
    sky.dispose()
    release()
    await loading

    expect(of(calls, 'texSubImage2D')).toHaveLength(0)
  })
})
