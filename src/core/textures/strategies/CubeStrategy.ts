import { CubeTexture, CubeTextureLoader } from 'three'
import { Storage } from '@/core/framework/file/Storage'
import type { TextureLoadStrategy, TextureRequest } from '@/core/textures/types'

/** Число граней кубической карты. */
const CUBE_FACE_COUNT: number = 6

/**
 * Загрузка кубической карты из шести граней.
 *
 * Порядок путей значим (px, nx, py, ny, pz, nz) и сохраняется как есть —
 * его задаёт вызывающий, собирая запрос из ресурсов сценария.
 */
class CubeStrategy implements TextureLoadStrategy {
  public constructor(private readonly loader: CubeTextureLoader) {}

  public static create(): CubeStrategy {
    return new CubeStrategy(new CubeTextureLoader())
  }

  public supports(request: TextureRequest): boolean {
    return request.paths.length === CUBE_FACE_COUNT
  }

  public async load(request: TextureRequest): Promise<CubeTexture> {
    const urls: string[] = request.paths.map((path: string): string => Storage.url(path))

    return await this.loader.loadAsync(urls)
  }
}

export { CubeStrategy }
