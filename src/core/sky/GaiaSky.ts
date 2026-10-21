import { CubeTexture, type WebGLRenderer } from 'three'
import { Storage } from '@/core/framework/file/Storage'
import { gaiaSkyUniforms, type GaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'
import { loadGaiaTiles, type GaiaLoadResult, type GaiaTileFetcher } from '@/core/sky/gaiaTileLoader'
import {
  GAIA_CUBE_SIZE,
  GAIA_LEVELS,
  GAIA_MAX_FINE_STAR_LEVEL,
  GaiaLevelTracker,
  gaiaTiles,
  gaiaTilePath,
  planGaiaUploads,
  type GaiaTextureKey,
  type GaiaTile
} from '@/core/sky/gaiaTiles'

export type GaiaSkyRenderer = Pick<WebGLRenderer, 'domElement' | 'getContext' | 'state' | 'properties' | 'extensions' | 'capabilities'>

export const fetchGaiaTile: GaiaTileFetcher = async (tile, signal) => {
  const response = await fetch(Storage.url(gaiaTilePath(tile)), { signal })
  if (!response.ok) throw new Error(`${tile.name}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

const TEXTURE_KEYS: readonly GaiaTextureKey[] = ['galaxy', 'stars', 'starsCoarse']

function reportGaiaLoad(result: GaiaLoadResult): GaiaLoadResult {
  if (result.cancelled) return result
  if (result.aborted) {
    console.warn('[GaiaSky] Тайлы неба не найдены — скачать: npm run fetch:gaia-sky')
  } else if (result.failed.length > 0) {
    const names = result.failed
      .slice(0, 5)
      .map((tile) => tile.name)
      .join(', ')
    console.warn(`[GaiaSky] Не загружено тайлов: ${result.failed.length} (${names})`)
  }
  return result
}

/**
 * Небо Gaia (данные Брунетона): три кубмапы RGB9_E5 — галактика, звёзды
 * (суммы потока, уровни 0…6) и грубые звёзды (средние, 7…11).
 *
 * Текстуры создаются напрямую через GL: three не умеет дозаливать тайл в кусок
 * кубмапы. В three они попадают обёртками CubeTexture без изображений: путь куба
 * при version 0 привязывает properties.__webglTexture — его ставим сами;
 * __webglInit не ставится, удаляет текстуры только GaiaSky. Привязки — только
 * через renderer.state: голый gl.bindTexture рассинхронизирует кэш three.
 *
 * Одна на приложение: небо общее для всех сценариев. После восстановления
 * контекста текстуры пересоздаются, тайлы загружаются заново; CPU-копии нет.
 */
export class GaiaSky {
  private gl: WebGL2RenderingContext | null = null
  private textures: Record<GaiaTextureKey, WebGLTexture> | null = null
  private readonly wrappers: Record<GaiaTextureKey, CubeTexture> = {
    galaxy: new CubeTexture(),
    stars: new CubeTexture(),
    starsCoarse: new CubeTexture()
  }
  private tracker = new GaiaLevelTracker()
  private galaxyMinLod = GAIA_LEVELS - 1
  private started = false
  private loadController: AbortController | null = null
  /** Тайлы прошлой загрузки (до dispose или потери контекста) в новые текстуры не пишутся */
  private generation = 0

  public constructor(
    private readonly renderer: GaiaSkyRenderer,
    private readonly uniforms: GaiaSkyUniforms = gaiaSkyUniforms,
    private readonly fetchTile: GaiaTileFetcher = fetchGaiaTile,
    private readonly tiles: readonly GaiaTile[] = gaiaTiles()
  ) {}

  /** Повторный вызов до dispose — null; при потерянном контексте ждём восстановления */
  public start(): Promise<GaiaLoadResult> | null {
    if (this.started) return null
    this.started = true
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored)
    return this.load()
  }

  public dispose(): void {
    this.started = false
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.releaseTextures()
  }

  private readonly onContextLost = (): void => {
    this.releaseTextures()
  }

  private readonly onContextRestored = (): void => {
    // Обработчик WebGLRenderer зарегистрирован первым: state/properties уже новые.
    if (this.started) void this.load()
  }

  private load(): Promise<GaiaLoadResult> | null {
    if (this.textures) return null
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    if (gl.isContextLost()) return null
    this.gl = gl
    this.tracker = new GaiaLevelTracker()
    this.textures = {
      galaxy: this.createCube(GAIA_LEVELS, GAIA_CUBE_SIZE, true),
      stars: this.createCube(GAIA_MAX_FINE_STAR_LEVEL + 1, GAIA_CUBE_SIZE, false),
      starsCoarse: this.createCube(
        GAIA_LEVELS - GAIA_MAX_FINE_STAR_LEVEL - 1,
        GAIA_CUBE_SIZE >> (GAIA_MAX_FINE_STAR_LEVEL + 1),
        true
      )
    }
    this.applyGalaxyMinLod(GAIA_LEVELS - 1)

    for (const key of TEXTURE_KEYS) {
      const properties = this.renderer.properties.get(this.wrappers[key]) as { __webglTexture?: WebGLTexture }
      properties.__webglTexture = this.textures[key]
    }
    this.uniforms.uGaiaGalaxy.value = this.wrappers.galaxy
    this.uniforms.uGaiaStars.value = this.wrappers.stars
    this.uniforms.uGaiaStarsCoarse.value = this.wrappers.starsCoarse

    const generation = ++this.generation
    this.loadController = new AbortController()
    return loadGaiaTiles(this.tiles, this.fetchTile, (tile, data) => {
      if (generation === this.generation) this.upload(tile, data)
    }, { signal: this.loadController.signal }).then(result =>
      generation === this.generation ? reportGaiaLoad(result) : result
    )
  }

  private releaseTextures(): void {
    this.generation++
    this.loadController?.abort()
    this.loadController = null
    const gl = this.gl
    const textures = this.textures
    for (const key of TEXTURE_KEYS) {
      // При потере контекста GL уже уничтожил объекты; старые handles не удаляем.
      if (gl && textures && !gl.isContextLost()) {
        gl.deleteTexture(textures[key])
      }
      this.renderer.properties.remove(this.wrappers[key])
    }
    this.gl = null
    this.textures = null
    this.uniforms.uGaiaGalaxy.value = null
    this.uniforms.uGaiaStars.value = null
    this.uniforms.uGaiaStarsCoarse.value = null
    this.uniforms.uGaiaMinLod.value = GAIA_LEVELS
    this.galaxyMinLod = GAIA_LEVELS - 1
  }

  private createCube(levels: number, size: number, linear: boolean): WebGLTexture {
    const gl = this.gl!
    const cube = gl.TEXTURE_CUBE_MAP
    const texture = gl.createTexture()!
    this.renderer.state.bindTexture(cube, texture)
    gl.texStorage2D(cube, levels, gl.RGB9_E5, size, size)
    gl.texParameteri(cube, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST)
    gl.texParameteri(cube, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(cube, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(cube, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // У «звёзд» уровни 7…11 живут в «грубых»: читать дальше 6 нельзя
    gl.texParameteri(cube, gl.TEXTURE_MAX_LEVEL, levels - 1)
    gl.texParameterf(cube, gl.TEXTURE_MAX_LOD, levels - 1)
    const anisotropy = this.renderer.extensions.get('EXT_texture_filter_anisotropic') as {
      TEXTURE_MAX_ANISOTROPY_EXT: number
    } | null
    if (linear && anisotropy) {
      gl.texParameterf(cube, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, this.renderer.capabilities.getMaxAnisotropy())
    }
    return texture
  }

  private upload(tile: GaiaTile, data: Uint32Array): void {
    const gl = this.gl
    const textures = this.textures
    // isContextLost становится true ещё до доставки webglcontextlost.
    if (!gl || !textures || gl.isContextLost()) return
    // three оставляет флаги распаковки своих текстур (flipY) — сброс до своих
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    for (const upload of planGaiaUploads(tile, data)) {
      this.renderer.state.bindTexture(gl.TEXTURE_CUBE_MAP, textures[upload.texture])
      gl.texSubImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + upload.face,
        upload.level,
        upload.x,
        upload.y,
        upload.size,
        upload.size,
        gl.RGB,
        gl.UNSIGNED_INT_5_9_9_9_REV,
        upload.data
      )
    }
    this.tracker.markLoaded(tile)
    // Читаются только полные уровни: незалитое чёрное, а не дыра в небе
    const complete = this.tracker.completeLevel()
    this.uniforms.uGaiaMinLod.value = Math.min(complete, GAIA_LEVELS)
    const galaxyMinLod = Math.min(complete, GAIA_LEVELS - 1)
    if (galaxyMinLod !== this.galaxyMinLod) this.applyGalaxyMinLod(galaxyMinLod)
  }

  private applyGalaxyMinLod(lod: number): void {
    const gl = this.gl!
    this.renderer.state.bindTexture(gl.TEXTURE_CUBE_MAP, this.textures!.galaxy)
    gl.texParameterf(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_LOD, lod)
    this.galaxyMinLod = lod
  }
}
